const transactionService = require('./transaction-service');

const { toCents } = transactionService;

const MANUAL_ENTRY_TYPES = {
  opening_balance: {
    direction: 'debit',
    label: 'Opening Balance'
  },
  old_sale: {
    direction: 'debit',
    label: 'Imported Old Sale'
  },
  manual_charge: {
    direction: 'debit',
    label: 'Manual Charge'
  },
  old_payment: {
    direction: 'credit',
    label: 'Imported Old Payment'
  },
  manual_credit: {
    direction: 'credit',
    label: 'Manual Credit'
  }
};

function centsToAmount(cents) {
  return Math.round(cents) / 100;
}

function normalizeIsoDate(value, fallbackDate = new Date()) {
  if (!value) {
    return fallbackDate.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid effective date.');
  }

  return parsed.toISOString();
}

function getCustomerIdValue(customer) {
  if (!customer || customer === 0 || customer === '0') {
    return null;
  }

  if (typeof customer === 'object') {
    return customer.id ?? customer._id ?? null;
  }

  return customer;
}

function idsMatch(left, right) {
  return String(left) === String(right);
}

function buildManualLedgerRow(entry) {
  const amount = Math.abs(Number.parseFloat(entry.amount) || 0);
  const debit = entry.direction === 'debit' ? amount : 0;
  const credit = entry.direction === 'credit' ? amount : 0;

  return {
    source: 'manual',
    source_id: entry._id,
    entry_type: entry.entry_type,
    type_label: MANUAL_ENTRY_TYPES[entry.entry_type]?.label || 'Manual Entry',
    ref: entry.reference || '-',
    description: entry.note || (MANUAL_ENTRY_TYPES[entry.entry_type]?.label || 'Manual Entry'),
    debit,
    credit,
    delta_cents: toCents(debit) - toCents(credit),
    date: entry.effective_at || entry.created_at,
    created_at: entry.created_at || entry.effective_at,
    user: entry.created_by || '',
    note: entry.note || ''
  };
}

function buildPaymentRow(payment) {
  const amount = Math.abs(Number.parseFloat(payment.amount) || 0);
  return {
    source: 'payment',
    source_id: payment._id,
    entry_type: 'payment_received',
    type_label: 'Payment Received',
    ref: '-',
    description: payment.note ? `Payment Received: ${payment.note}` : 'Payment Received',
    debit: 0,
    credit: amount,
    delta_cents: -toCents(amount),
    date: payment.created_at,
    created_at: payment.created_at,
    user: payment.received_by || '',
    note: payment.note || ''
  };
}

function buildTransactionRow(transaction) {
  const amount = Math.abs(Number.parseFloat(transaction.total) || 0);
  const isRefund = transactionService.normalizeTransactionType(transaction.transaction_type) === 'refund';
  const ref = transaction.order || transaction._id || '-';

  return {
    source: 'transaction',
    source_id: transaction._id,
    entry_type: isRefund ? 'on_account_refund' : 'on_account_sale',
    type_label: isRefund ? 'On Account Refund' : 'On Account Sale',
    ref,
    description: isRefund
      ? `Refund for invoice ${transaction.refund_of || ref}`
      : `Invoice ${ref}`,
    debit: isRefund ? 0 : amount,
    credit: isRefund ? amount : 0,
    delta_cents: isRefund ? -toCents(amount) : toCents(amount),
    date: transaction.date,
    created_at: transaction.created_at || transaction.date,
    user: transaction.user || '',
    note: transaction.refund_reason || ''
  };
}

function buildLegacyRow(balanceDifferenceCents, rows) {
  const earliestDate = rows.length > 0
    ? new Date(rows[0].date || rows[0].created_at || new Date())
    : new Date();

  if (Number.isNaN(earliestDate.getTime())) {
    earliestDate.setTime(Date.now());
  }

  earliestDate.setMilliseconds(earliestDate.getMilliseconds() - 1);

  const debit = balanceDifferenceCents > 0 ? centsToAmount(balanceDifferenceCents) : 0;
  const credit = balanceDifferenceCents < 0 ? centsToAmount(Math.abs(balanceDifferenceCents)) : 0;

  return {
    source: 'system',
    source_id: 'legacy-balance',
    entry_type: 'legacy_balance',
    type_label: 'Legacy Balance',
    ref: '-',
    description: 'Legacy balance migration adjustment',
    debit,
    credit,
    delta_cents: balanceDifferenceCents,
    date: earliestDate.toISOString(),
    created_at: earliestDate.toISOString(),
    user: 'System',
    note: ''
  };
}

function compareLedgerRows(left, right) {
  const leftDate = new Date(left.date || left.created_at || 0).getTime();
  const rightDate = new Date(right.date || right.created_at || 0).getTime();
  if (leftDate !== rightDate) {
    return leftDate - rightDate;
  }

  const sourceOrder = {
    system: 0,
    manual: 1,
    transaction: 2,
    payment: 3
  };

  const leftOrder = sourceOrder[left.source] ?? 99;
  const rightOrder = sourceOrder[right.source] ?? 99;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.source_id || '').localeCompare(String(right.source_id || ''));
}

function buildCustomerStatement({ customer, transactions = [], payments = [], manualEntries = [] }) {
  const customerId = customer?._id;

  const ledgerTransactions = transactions
    .filter(transaction => transactionService.normalizeStatus(transaction.status) === 1)
    .filter(transaction => (transaction.payment_type || '') === 'On Account')
    .filter(transaction => idsMatch(getCustomerIdValue(transaction.customer), customerId))
    .map(buildTransactionRow);

  const ledgerPayments = payments
    .filter(payment => !payment.ledger_entry_id)
    .filter(payment => idsMatch(payment.customerId, customerId))
    .map(buildPaymentRow);

  const ledgerManualEntries = manualEntries
    .filter(entry => idsMatch(entry.customerId, customerId))
    .map(buildManualLedgerRow);

  let rows = [
    ...ledgerTransactions,
    ...ledgerPayments,
    ...ledgerManualEntries
  ].sort(compareLedgerRows);

  const currentBalanceCents = toCents(customer?.balance || 0);
  const calculatedBalanceCents = rows.reduce((sum, row) => sum + row.delta_cents, 0);
  const balanceDifferenceCents = currentBalanceCents - calculatedBalanceCents;

  if (balanceDifferenceCents !== 0) {
    rows = [buildLegacyRow(balanceDifferenceCents, rows), ...rows].sort(compareLedgerRows);
  }

  let runningBalanceCents = 0;
  const statementRows = rows.map(row => {
    runningBalanceCents += row.delta_cents;
    return {
      ...row,
      running_balance: centsToAmount(runningBalanceCents)
    };
  });

  return {
    customerId,
    customerName: customer?.name || '',
    currentBalance: centsToAmount(currentBalanceCents),
    rows: statementRows.slice().reverse()
  };
}

async function updateById(db, id, updateFields) {
  return new Promise((resolve, reject) => {
    db.update({ _id: id }, { $set: updateFields }, {}, (error, count) => {
      if (error) {
        reject(error);
        return;
      }

      if (count === 0) {
        reject(new Error(`Document ${id} was not found.`));
        return;
      }

      resolve();
    });
  });
}

async function insertOne(db, document) {
  return new Promise((resolve, reject) => {
    db.insert(document, (error, inserted) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(inserted);
    });
  });
}

async function recordManualLedgerEntry(customersDb, ledgerDb, customer, payload) {
  const config = MANUAL_ENTRY_TYPES[payload.entryType];
  if (!config) {
    throw new Error('Invalid ledger entry type.');
  }

  const amountCents = toCents(payload.amount);
  if (amountCents <= 0) {
    throw new Error('Ledger entry amount must be greater than zero.');
  }

  const previousBalanceCents = toCents(customer.balance || 0);
  const deltaCents = config.direction === 'debit' ? amountCents : -amountCents;
  const nextBalanceCents = previousBalanceCents + deltaCents;

  if (nextBalanceCents < 0) {
    throw new Error('Ledger credit exceeds the customer outstanding balance.');
  }

  const now = new Date();
  const entry = {
    _id: `${Date.now()}_${customer._id}_${Math.round(Math.random() * 100000)}`,
    customerId: customer._id,
    customerName: customer.name,
    entry_type: payload.entryType,
    direction: config.direction,
    amount: centsToAmount(amountCents),
    signed_amount: centsToAmount(deltaCents),
    balance_before: centsToAmount(previousBalanceCents),
    balance_after: centsToAmount(nextBalanceCents),
    note: String(payload.note || '').trim(),
    reference: String(payload.reference || '').trim(),
    effective_at: normalizeIsoDate(payload.effectiveAt, now),
    created_at: now.toISOString(),
    created_by: payload.createdBy || 'unknown',
    created_by_id: payload.createdById || 0,
    source: 'manual'
  };

  await updateById(customersDb, customer._id, {
    balance: centsToAmount(nextBalanceCents)
  });

  try {
    await insertOne(ledgerDb, entry);
  } catch (error) {
    await updateById(customersDb, customer._id, {
      balance: centsToAmount(previousBalanceCents)
    });
    throw error;
  }

  return entry;
}

module.exports = {
  MANUAL_ENTRY_TYPES,
  buildCustomerStatement,
  buildManualLedgerRow,
  buildPaymentRow,
  buildTransactionRow,
  recordManualLedgerEntry
};
