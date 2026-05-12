const test = require('node:test');
const assert = require('node:assert/strict');

const ledgerService = require('../api/supplier-ledger-service');

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
    dump() {
      return JSON.parse(JSON.stringify(documents));
    }
  };
}

test('manual supplier debit entry updates balance and writes audit row', async () => {
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributors', balance: 40 }]);
  const ledgerDb = createMockDb([]);

  const entry = await ledgerService.recordManualLedgerEntry(
    suppliersDb,
    ledgerDb,
    { _id: 's1', name: 'Tokyo Distributors', balance: 40 },
    {
      entryType: 'old_purchase',
      amount: 15,
      note: 'Imported old supplier invoice',
      reference: 'SUP-001',
      effectiveAt: '2026-05-01T09:30:00',
      createdBy: 'Administrator',
      createdById: 1
    }
  );

  assert.equal(suppliersDb.dump()[0].balance, 55);
  assert.equal(ledgerDb.dump().length, 1);
  assert.equal(entry.balance_before, 40);
  assert.equal(entry.balance_after, 55);
  assert.equal(entry.direction, 'debit');
  assert.equal(entry.entry_type, 'old_purchase');
});

test('supplier settlement can create supplier advance balance below zero', async () => {
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributors', balance: 10 }]);
  const ledgerDb = createMockDb([]);

  const entry = await ledgerService.recordManualLedgerEntry(
    suppliersDb,
    ledgerDb,
    { _id: 's1', name: 'Tokyo Distributors', balance: 10 },
    {
      entryType: 'manual_credit',
      amount: 15,
      note: 'Advance settlement for next delivery',
      effectiveAt: '2026-05-01T09:30:00',
      createdBy: 'Administrator',
      createdById: 1
    }
  );

  assert.equal(suppliersDb.dump()[0].balance, -5);
  assert.equal(ledgerDb.dump().length, 1);
  assert.equal(entry.balance_before, 10);
  assert.equal(entry.balance_after, -5);
  assert.equal(entry.direction, 'credit');
});

test('supplier payment reduces balance and stores payment record', async () => {
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributors', balance: 100 }]);
  const paymentsDb = createMockDb([]);

  const payment = await ledgerService.recordSupplierPayment(
    suppliersDb,
    paymentsDb,
    { _id: 's1', name: 'Tokyo Distributors', balance: 100 },
    {
      amount: 25,
      note: 'Bank transfer',
      reference: 'TRX-1',
      paidBy: 'Administrator',
      paidById: 1
    }
  );

  assert.equal(suppliersDb.dump()[0].balance, 75);
  assert.equal(paymentsDb.dump().length, 1);
  assert.equal(payment.balance_before, 100);
  assert.equal(payment.balance_after, 75);
});

test('supplier payment can create supplier advance balance below zero', async () => {
  const suppliersDb = createMockDb([{ _id: 's1', name: 'Tokyo Distributors', balance: 100 }]);
  const paymentsDb = createMockDb([]);

  const payment = await ledgerService.recordSupplierPayment(
    suppliersDb,
    paymentsDb,
    { _id: 's1', name: 'Tokyo Distributors', balance: 100 },
    {
      amount: 150,
      note: 'Advance for next shipment',
      reference: 'TRX-ADV',
      paidBy: 'Administrator',
      paidById: 1
    }
  );

  assert.equal(suppliersDb.dump()[0].balance, -50);
  assert.equal(paymentsDb.dump().length, 1);
  assert.equal(payment.balance_before, 100);
  assert.equal(payment.balance_after, -50);
});

test('supplier statement merges purchases, payments, and manual entries with running balance', () => {
  const statement = ledgerService.buildSupplierStatement({
    supplier: { _id: 's1', name: 'Tokyo Distributors', balance: 90 },
    purchases: [
      {
        _id: 'p1',
        supplierId: 's1',
        total: 100,
        created_at: '2026-05-01T10:00:00.000Z',
        received_by: 'Cashier A',
        items: [{ productId: 1, quantity: 2, cost_price: 50 }]
      }
    ],
    payments: [
      {
        _id: 'pay1',
        supplierId: 's1',
        amount: 20,
        created_at: '2026-05-03T10:00:00.000Z',
        paid_by: 'Cashier C',
        note: 'Paid cash'
      }
    ],
    manualEntries: [
      {
        _id: 'manual-1',
        supplierId: 's1',
        entry_type: 'opening_balance',
        direction: 'debit',
        amount: 10,
        effective_at: '2026-05-01T09:00:00.000Z',
        created_at: '2026-05-01T09:00:00.000Z',
        created_by: 'Administrator',
        note: 'Opening payable'
      }
    ],
    products: [
      { _id: 1, name: 'XROS 0.8' }
    ]
  });

  assert.equal(statement.currentBalance, 90);
  assert.equal(statement.rows.length, 3);
  assert.equal(statement.rows[0].type_label, 'Settlement Paid');
  assert.equal(statement.rows[0].running_balance, 90);
  assert.equal(statement.rows[1].type_label, 'Stock Received');
  assert.equal(statement.rows[1].running_balance, 110);
  assert.equal(statement.rows[2].type_label, 'Opening Balance');
  assert.equal(statement.rows[2].running_balance, 10);
});

test('supplier statement adds legacy balance row when history does not explain current payable', () => {
  const statement = ledgerService.buildSupplierStatement({
    supplier: { _id: 's9', name: 'Legacy Supplier', balance: 50 },
    purchases: [],
    payments: [],
    manualEntries: [],
    products: []
  });

  assert.equal(statement.rows.length, 1);
  assert.equal(statement.rows[0].type_label, 'Legacy Balance');
  assert.equal(statement.rows[0].running_balance, 50);
});
