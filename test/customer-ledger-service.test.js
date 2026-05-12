const test = require('node:test');
const assert = require('node:assert/strict');

const ledgerService = require('../api/customer-ledger-service');

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

test('manual ledger debit entry updates customer balance and writes audit row', async () => {
  const customersDb = createMockDb([{ _id: 101, name: 'Nasir', balance: 40 }]);
  const ledgerDb = createMockDb([]);

  const entry = await ledgerService.recordManualLedgerEntry(
    customersDb,
    ledgerDb,
    { _id: 101, name: 'Nasir', balance: 40 },
    {
      entryType: 'old_sale',
      amount: 15,
      note: 'Imported old due from notebook',
      reference: 'OLD-001',
      effectiveAt: '2026-05-01T09:30:00',
      createdBy: 'Administrator',
      createdById: 1
    }
  );

  assert.equal(customersDb.dump()[0].balance, 55);
  assert.equal(ledgerDb.dump().length, 1);
  assert.equal(entry.balance_before, 40);
  assert.equal(entry.balance_after, 55);
  assert.equal(entry.direction, 'debit');
  assert.equal(entry.entry_type, 'old_sale');
});

test('manual ledger credit cannot reduce balance below zero', async () => {
  const customersDb = createMockDb([{ _id: 101, name: 'Nasir', balance: 10 }]);
  const ledgerDb = createMockDb([]);

  await assert.rejects(
    () => ledgerService.recordManualLedgerEntry(
      customersDb,
      ledgerDb,
      { _id: 101, name: 'Nasir', balance: 10 },
      {
        entryType: 'old_payment',
        amount: 15,
        note: 'Too large credit',
        effectiveAt: '2026-05-01T09:30:00',
        createdBy: 'Administrator',
        createdById: 1
      }
    ),
    /exceeds the customer outstanding balance/
  );

  assert.equal(customersDb.dump()[0].balance, 10);
  assert.equal(ledgerDb.dump().length, 0);
});

test('customer statement merges sales, refunds, payments, and manual entries with running balance', () => {
  const statement = ledgerService.buildCustomerStatement({
    customer: { _id: 501, name: 'Ali Khan', balance: 90 },
    transactions: [
      {
        _id: 1,
        order: 1001,
        customer: { id: 501, name: 'Ali Khan' },
        status: 1,
        payment_type: 'On Account',
        total: '100.00',
        date: '2026-05-01T10:00:00.000Z',
        user: 'Cashier A'
      },
      {
        _id: 2,
        order: 1002,
        refund_of: 1001,
        transaction_type: 'refund',
        customer: { id: 501, name: 'Ali Khan' },
        status: 1,
        payment_type: 'On Account',
        total: '-10.00',
        date: '2026-05-04T10:00:00.000Z',
        user: 'Cashier B'
      }
    ],
    payments: [
      {
        _id: 'payment-1',
        customerId: 501,
        amount: 20,
        created_at: '2026-05-03T10:00:00.000Z',
        received_by: 'Cashier C'
      }
    ],
    manualEntries: [
      {
        _id: 'manual-1',
        customerId: 501,
        entry_type: 'opening_balance',
        direction: 'debit',
        amount: 20,
        effective_at: '2026-05-01T09:00:00.000Z',
        created_at: '2026-05-01T09:00:00.000Z',
        created_by: 'Administrator',
        note: 'Opening balance entered'
      }
    ]
  });

  assert.equal(statement.currentBalance, 90);
  assert.equal(statement.rows.length, 4);
  assert.equal(statement.rows[0].type_label, 'On Account Refund');
  assert.equal(statement.rows[0].running_balance, 90);
  assert.equal(statement.rows[1].type_label, 'Payment Received');
  assert.equal(statement.rows[1].running_balance, 100);
  assert.equal(statement.rows[2].type_label, 'On Account Sale');
  assert.equal(statement.rows[2].running_balance, 120);
  assert.equal(statement.rows[3].type_label, 'Opening Balance');
  assert.equal(statement.rows[3].running_balance, 20);
});

test('statement adds legacy balance row when historical entries do not explain current balance', () => {
  const statement = ledgerService.buildCustomerStatement({
    customer: { _id: 99, name: 'Legacy Customer', balance: 50 },
    transactions: [],
    payments: [],
    manualEntries: []
  });

  assert.equal(statement.rows.length, 1);
  assert.equal(statement.rows[0].type_label, 'Legacy Balance');
  assert.equal(statement.rows[0].running_balance, 50);
});
