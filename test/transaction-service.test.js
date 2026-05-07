const test = require('node:test');
const assert = require('node:assert/strict');

const transactionService = require('../api/transaction-service');

function createMockDb(initialDocuments = []) {
  const documents = initialDocuments.map(document => JSON.parse(JSON.stringify(document)));

  const matches = (query, document) => {
    if (query.$or) {
      return query.$or.some(condition => matches(condition, document));
    }

    return Object.entries(query).every(([key, value]) => document[key] === value);
  };

  return {
    findOne(query, callback) {
      const document = documents.find(entry => matches(query, entry));
      callback(null, document ? JSON.parse(JSON.stringify(document)) : null);
    },
    insert(document, callback) {
      documents.push(JSON.parse(JSON.stringify(document)));
      callback(null, document);
    },
    update(query, updateDocument, options, callback) {
      const index = documents.findIndex(entry => matches(query, entry));
      if (index === -1) {
        callback(null, 0);
        return;
      }

      if (updateDocument.$set) {
        documents[index] = { ...documents[index], ...JSON.parse(JSON.stringify(updateDocument.$set)) };
      } else {
        documents[index] = JSON.parse(JSON.stringify(updateDocument));
      }

      callback(null, 1);
    },
    remove(query, options, callback) {
      const index = documents.findIndex(entry => matches(query, entry));
      if (index === -1) {
        callback(null, 0);
        return;
      }

      documents.splice(index, 1);
      callback(null, 1);
    },
    dump() {
      return JSON.parse(JSON.stringify(documents));
    }
  };
}

test('held orders do not deduct stock or change customer balance', async () => {
  const inventoryDb = createMockDb([{ _id: 1001, name: 'Pod Kit', stock: 1, quantity: 5 }]);
  const customersDb = createMockDb([{ _id: 10, name: 'Alice', balance: 0 }]);

  const heldOrder = transactionService.prepareTransaction(null, {
    _id: 1,
    order: 1,
    customer: { id: 10, name: 'Alice' },
    status: 0,
    payment_type: 'Cash',
    total: '20.00',
    paid: '',
    items: [{ id: 1001, quantity: 2 }]
  }, 'created');

  await transactionService.applyFinalizationSideEffects(heldOrder, inventoryDb, customersDb);

  assert.equal(inventoryDb.dump()[0].quantity, 5);
  assert.equal(customersDb.dump()[0].balance, 0);
});

test('finalizing a held cash order deducts stock exactly once', async () => {
  const inventoryDb = createMockDb([{ _id: 1001, name: 'Pod Kit', stock: 1, quantity: 5 }]);
  const customersDb = createMockDb([]);

  const finalizedOrder = transactionService.prepareTransaction({
    _id: 1,
    status: 0,
    created_at: new Date().toISOString(),
    held_at: new Date().toISOString(),
    status_history: []
  }, {
    _id: 1,
    order: 1,
    customer: 0,
    status: 1,
    payment_type: 'Cash',
    total: '20.00',
    paid: '20.00',
    items: [{ id: 1001, quantity: 2 }],
    user: 'Cashier',
    user_id: 5
  }, 'updated');

  await transactionService.applyFinalizationSideEffects(finalizedOrder, inventoryDb, customersDb);

  assert.equal(inventoryDb.dump()[0].quantity, 3);
  assert.equal(finalizedOrder.completed_by, 'Cashier');
  assert.equal(finalizedOrder.status_history.at(-1).to_status, 1);
});

test('finalizing an on-account held order updates stock and customer ledger', async () => {
  const inventoryDb = createMockDb([{ _id: 1001, name: 'Pod Kit', stock: 1, quantity: 8 }]);
  const customersDb = createMockDb([{ _id: 10, name: 'Alice', balance: 5 }]);

  const finalizedOrder = transactionService.prepareTransaction({
    _id: 2,
    status: 0,
    created_at: new Date().toISOString(),
    held_at: new Date().toISOString(),
    status_history: []
  }, {
    _id: 2,
    order: 2,
    customer: { id: 10, name: 'Alice' },
    status: 1,
    payment_type: 'On Account',
    total: '12.50',
    paid: '',
    items: [{ id: 1001, quantity: 3 }],
    user: 'Cashier',
    user_id: 5
  }, 'updated');

  await transactionService.applyFinalizationSideEffects(finalizedOrder, inventoryDb, customersDb);

  assert.equal(inventoryDb.dump()[0].quantity, 5);
  assert.equal(customersDb.dump()[0].balance, 17.5);
});

test('insufficient stock fails safely without mutating inventory or ledger', async () => {
  const inventoryDb = createMockDb([{ _id: 1001, name: 'Pod Kit', stock: 1, quantity: 1 }]);
  const customersDb = createMockDb([{ _id: 10, name: 'Alice', balance: 5 }]);

  const finalizedOrder = transactionService.prepareTransaction({
    _id: 3,
    status: 0,
    created_at: new Date().toISOString(),
    held_at: new Date().toISOString(),
    status_history: []
  }, {
    _id: 3,
    order: 3,
    customer: { id: 10, name: 'Alice' },
    status: 1,
    payment_type: 'On Account',
    total: '12.50',
    paid: '',
    items: [{ id: 1001, quantity: 3 }],
    user: 'Cashier',
    user_id: 5
  }, 'updated');

  await assert.rejects(
    () => transactionService.applyFinalizationSideEffects(finalizedOrder, inventoryDb, customersDb),
    /Insufficient stock/
  );

  assert.equal(inventoryDb.dump()[0].quantity, 1);
  assert.equal(customersDb.dump()[0].balance, 5);
});
