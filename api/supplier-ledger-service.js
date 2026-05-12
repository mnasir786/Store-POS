const transactionService = require('./transaction-service');

const { toCents } = transactionService;

const MANUAL_ENTRY_TYPES = {
  opening_balance: {
    direction: 'debit',
    label: 'Opening Balance'
  },
  old_purchase: {
    direction: 'debit',
    label: 'Imported Old Purchase'
  },
  manual_charge: {
    direction: 'debit',
    label: 'Manual Charge'
  },
  old_payment: {
    direction: 'credit',
    label: 'Imported Old Settlement'
  },
  manual_credit: {
    direction: 'credit',
    label: 'Manual Settlement'
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
    entry_type: 'payment_made',
    type_label: 'Settlement Paid',
    ref: payment.reference || '-',
    description: payment.note ? `Settlement Paid: ${payment.note}` : 'Settlement Paid',
    debit: 0,
    credit: amount,
    delta_cents: -toCents(amount),
    date: payment.created_at,
    created_at: payment.created_at,
    user: payment.paid_by || '',
    note: payment.note || ''
  };
}

function buildPurchaseRow(purchase, productLookup = {}) {
  const amount = Math.abs(Number.parseFloat(purchase.total) || 0);
  const itemSummary = (purchase.items || []).map(item => {
    const product = productLookup[String(item.productId)] || {};
    const label = product.name || `Product #${item.productId}`;
    const qty = Number.parseInt(item.quantity, 10) || 0;
    const cost = Number.parseFloat(item.cost_price) || 0;
    return `${label} x${qty}${cost > 0 ? ` @ Rs.${cost.toFixed(2)}` : ''}`;
  }).join('; ');

  return {
    source: 'purchase',
    source_id: purchase._id,
    entry_type: 'stock_received',
    type_label: 'Stock Received',
    ref: purchase._id || '-',
    description: itemSummary || purchase.notes || 'Stock Received',
    debit: amount,
    credit: 0,
    delta_cents: toCents(amount),
    date: purchase.created_at,
    created_at: purchase.created_at,
    user: purchase.received_by || '',
    note: purchase.notes || ''
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
    description: 'Legacy supplier balance migration adjustment',
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
    purchase: 2,
    payment: 3
  };

  const leftOrder = sourceOrder[left.source] ?? 99;
  const rightOrder = sourceOrder[right.source] ?? 99;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.source_id || '').localeCompare(String(right.source_id || ''));
}

function buildSupplierStatement({
  supplier,
  purchases = [],
  payments = [],
  manualEntries = [],
  products = []
}) {
  const supplierId = supplier?._id;
  const productLookup = {};
  (products || []).forEach(product => {
    productLookup[String(product._id)] = product;
  });

  const ledgerPurchases = purchases
    .filter(purchase => idsMatch(purchase.supplierId, supplierId))
    .map(purchase => buildPurchaseRow(purchase, productLookup));

  const ledgerPayments = payments
    .filter(payment => !payment.ledger_entry_id)
    .filter(payment => idsMatch(payment.supplierId, supplierId))
    .map(buildPaymentRow);

  const ledgerManualEntries = manualEntries
    .filter(entry => idsMatch(entry.supplierId, supplierId))
    .map(buildManualLedgerRow);

  let rows = [
    ...ledgerPurchases,
    ...ledgerPayments,
    ...ledgerManualEntries
  ].sort(compareLedgerRows);

  const currentBalanceCents = toCents(supplier?.balance || 0);
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
    supplierId,
    supplierName: supplier?.name || '',
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

async function recordManualLedgerEntry(suppliersDb, ledgerDb, supplier, payload) {
  const config = MANUAL_ENTRY_TYPES[payload.entryType];
  if (!config) {
    throw new Error('Invalid supplier ledger entry type.');
  }

  const amountCents = toCents(payload.amount);
  if (amountCents <= 0) {
    throw new Error('Supplier ledger entry amount must be greater than zero.');
  }

  const previousBalanceCents = toCents(supplier.balance || 0);
  const deltaCents = config.direction === 'debit' ? amountCents : -amountCents;
  const nextBalanceCents = previousBalanceCents + deltaCents;

  if (nextBalanceCents < 0) {
    throw new Error('Supplier settlement exceeds the outstanding balance.');
  }

  const now = new Date();
  const entry = {
    _id: `${Date.now()}_${supplier._id}_${Math.round(Math.random() * 100000)}`,
    supplierId: supplier._id,
    supplierName: supplier.name,
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

  await updateById(suppliersDb, supplier._id, {
    balance: centsToAmount(nextBalanceCents)
  });

  try {
    await insertOne(ledgerDb, entry);
  } catch (error) {
    await updateById(suppliersDb, supplier._id, {
      balance: centsToAmount(previousBalanceCents)
    });
    throw error;
  }

  return entry;
}

async function recordSupplierPayment(suppliersDb, paymentsDb, supplier, payload) {
  const amountCents = toCents(payload.amount);
  if (amountCents <= 0) {
    throw new Error('Settlement amount must be greater than zero.');
  }

  const previousBalanceCents = toCents(supplier.balance || 0);
  if (amountCents > previousBalanceCents) {
    throw new Error('Settlement amount exceeds the supplier outstanding balance.');
  }

  const nextBalanceCents = previousBalanceCents - amountCents;
  const now = new Date();
  const payment = {
    _id: `${Date.now()}_${supplier._id}_${Math.round(Math.random() * 100000)}`,
    supplierId: supplier._id,
    supplierName: supplier.name,
    amount: centsToAmount(amountCents),
    note: String(payload.note || '').trim(),
    reference: String(payload.reference || '').trim(),
    created_at: now.toISOString(),
    paid_by: payload.paidBy || 'unknown',
    paid_by_id: payload.paidById || 0,
    balance_before: centsToAmount(previousBalanceCents),
    balance_after: centsToAmount(nextBalanceCents)
  };

  await updateById(suppliersDb, supplier._id, {
    balance: centsToAmount(nextBalanceCents)
  });

  try {
    await insertOne(paymentsDb, payment);
  } catch (error) {
    await updateById(suppliersDb, supplier._id, {
      balance: centsToAmount(previousBalanceCents)
    });
    throw error;
  }

  return payment;
}

module.exports = {
  MANUAL_ENTRY_TYPES,
  buildSupplierStatement,
  recordManualLedgerEntry,
  recordSupplierPayment
};
