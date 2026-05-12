const test = require('node:test');
const assert = require('node:assert/strict');

const purchaseReceivingService = require('../api/purchase-receiving-service');

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
      const clone = JSON.parse(JSON.stringify(document));
      documents.push(clone);
      callback(null, clone);
    },
    update(query, updateDocument, options, callback) {
      const index = documents.findIndex(entry => matches(query, entry));
      if (index === -1) {
        callback(null, 0);
        return;
      }

      documents[index] = {
        ...documents[index],
        ...(updateDocument.$set || {})
      };
      callback(null, 1);
    },
    remove(query, options, callback) {
      const index = documents.findIndex(entry => matches(query, entry));
      if (index !== -1) {
        documents.splice(index, 1);
      }
      callback(null, index !== -1 ? 1 : 0);
    },
    dump() {
      return JSON.parse(JSON.stringify(documents));
    }
  };
}

test('buildPurchaseAmounts supports detailed totals and exact invoice matching', () => {
  const detailed = purchaseReceivingService.buildPurchaseAmounts([
    { quantity: 2, cost_price: 100 },
    { quantity: 1, cost_price: 50 }
  ], 0, 0);

  assert.equal(detailed.lineTotal, 250);
  assert.equal(detailed.purchaseTotal, 250);
  assert.equal(detailed.outstanding, 250);

  const bulk = purchaseReceivingService.buildPurchaseAmounts([
    { quantity: 2, cost_price: 5000 },
    { quantity: 1, cost_price: 5000 }
  ], 15000, 5000);

  assert.equal(bulk.lineTotal, 15000);
  assert.equal(bulk.invoiceTotal, 15000);
  assert.equal(bulk.purchaseTotal, 15000);
  assert.equal(bulk.paidNow, 5000);
  assert.equal(bulk.outstanding, 10000);
});

test('buildPurchaseAmounts rejects invoice totals that do not match line totals', () => {
  assert.throws(
    () => purchaseReceivingService.buildPurchaseAmounts([
      { quantity: 1, cost_price: 1000 },
      { quantity: 2, cost_price: 2000 }
    ], 6000, 0),
    /must exactly match the supplier invoice total/
  );
});

test('receiveStock requires supplier and invoice total', async () => {
  const inventoryDb = createMockDb([{ _id: 1, name: 'XROS 0.8', quantity: 2, purchase_price: 700 }]);
  const purchasesDb = createMockDb([]);
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributor', balance: 1000 }]);
  const supplierPaymentsDb = createMockDb([]);

  await assert.rejects(
    () => purchaseReceivingService.receiveStock({
      inventoryDb,
      purchasesDb,
      suppliersDb,
      supplierPaymentsDb,
      payload: {
        supplierId: '',
        supplierName: 'Manual',
        items: [{ productId: 1, quantity: 1, cost_price: 700 }],
        invoice_total: 700,
        paid_now: 0,
        notes: 'Missing supplier',
        received_by: 'Administrator',
        received_by_id: 1
      }
    }),
    /Supplier is required/
  );

  await assert.rejects(
    () => purchaseReceivingService.receiveStock({
      inventoryDb,
      purchasesDb,
      suppliersDb,
      supplierPaymentsDb,
      payload: {
        supplierId: 's1',
        supplierName: 'Tokyo Distributor',
        items: [{ productId: 1, quantity: 1, cost_price: 700 }],
        invoice_total: 0,
        paid_now: 0,
        notes: 'Missing invoice total',
        received_by: 'Administrator',
        received_by_id: 1
      }
    }),
    /Invoice total is required/
  );
});

test('receiveStock updates quantities, tracks supplier payable, and records auto settlement', async () => {
  const inventoryDb = createMockDb([
    { _id: 1, name: 'XROS 0.8', quantity: 2, purchase_price: 700 },
    { _id: 2, name: 'Classic Series', quantity: 5, purchase_price: 1800 }
  ]);
  const purchasesDb = createMockDb([]);
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributor', balance: 1000 }]);
  const supplierPaymentsDb = createMockDb([]);

  const result = await purchaseReceivingService.receiveStock({
    inventoryDb,
    purchasesDb,
    suppliersDb,
    supplierPaymentsDb,
    payload: {
      supplierId: 's1',
      supplierName: 'Tokyo Distributor',
      items: [
        { productId: 1, quantity: 2, cost_price: 3000 },
        { productId: 2, quantity: 3, cost_price: 3000 }
      ],
      invoice_total: 15000,
      paid_now: 5000,
      notes: 'Bulk supplier invoice',
      received_by: 'Administrator',
      received_by_id: 1
    }
  });

  const inventory = inventoryDb.dump();
  assert.equal(inventory.find(item => item._id === 1).quantity, 4);
  assert.equal(inventory.find(item => item._id === 2).quantity, 8);

  const supplier = suppliersDb.dump()[0];
  assert.equal(supplier.balance, 11000);

  const purchase = purchasesDb.dump()[0];
  assert.equal(purchase.total, 15000);
  assert.equal(purchase.paid_now, 5000);
  assert.equal(purchase.outstanding, 10000);
  assert.equal(result.totals.outstanding, 10000);

  const payment = supplierPaymentsDb.dump()[0];
  assert.equal(payment.amount, 5000);
  assert.equal(payment.balance_before, 16000);
  assert.equal(payment.balance_after, 11000);
});

test('receiveStock rolls back inventory and supplier balance if payment insert fails', async () => {
  const inventoryDb = createMockDb([{ _id: 1, name: 'XROS 0.8', quantity: 2, purchase_price: 700 }]);
  const purchasesDb = createMockDb([]);
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributor', balance: 1000 }]);
  const supplierPaymentsDb = {
    ...createMockDb([]),
    insert(document, callback) {
      callback(new Error('Simulated payment insert failure'));
    }
  };

  await assert.rejects(
    () => purchaseReceivingService.receiveStock({
      inventoryDb,
      purchasesDb,
      suppliersDb,
      supplierPaymentsDb,
      payload: {
        supplierId: 's1',
        supplierName: 'Tokyo Distributor',
        items: [{ productId: 1, quantity: 2, cost_price: 7500 }],
        invoice_total: 15000,
        paid_now: 5000,
        notes: 'Rollback case',
        received_by: 'Administrator',
        received_by_id: 1
      }
    }),
    /Simulated payment insert failure/
  );

  assert.equal(inventoryDb.dump()[0].quantity, 2);
  assert.equal(suppliersDb.dump()[0].balance, 1000);
  assert.equal(purchasesDb.dump().length, 0);
});

test('receiveStock rejects supplier invoice totals that do not match line cost totals', async () => {
  const inventoryDb = createMockDb([{ _id: 1, name: 'XROS 0.8', quantity: 2, purchase_price: 700 }]);
  const purchasesDb = createMockDb([]);
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributor', balance: 1000 }]);
  const supplierPaymentsDb = createMockDb([]);

  await assert.rejects(
    () => purchaseReceivingService.receiveStock({
      inventoryDb,
      purchasesDb,
      suppliersDb,
      supplierPaymentsDb,
      payload: {
        supplierId: 's1',
        supplierName: 'Tokyo Distributor',
        items: [{ productId: 1, quantity: 2, cost_price: 1000 }],
        invoice_total: 15000,
        paid_now: 0,
        notes: 'Mismatch case',
        received_by: 'Administrator',
        received_by_id: 1
      }
    }),
    /must exactly match the supplier invoice total/
  );

  assert.equal(inventoryDb.dump()[0].quantity, 2);
  assert.equal(suppliersDb.dump()[0].balance, 1000);
  assert.equal(purchasesDb.dump().length, 0);
  assert.equal(supplierPaymentsDb.dump().length, 0);
});
