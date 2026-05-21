function toCents(value) {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }

  const numericValue = Number.parseFloat(value);
  if (Number.isNaN(numericValue)) {
    return 0;
  }

  return Math.round(numericValue * 100);
}

function centsToAmount(value) {
  return Number.parseFloat((value / 100).toFixed(2));
}

function normalizeStatus(value) {
  const status = Number.parseInt(value, 10);
  return Number.isNaN(status) ? 0 : status;
}

function normalizeTransactionType(value) {
  return value === 'refund' ? 'refund' : 'sale';
}

function hasCustomer(transaction) {
  return transaction.customer && transaction.customer !== 0 && transaction.customer !== '0';
}

function getCustomerId(transaction) {
  if (!hasCustomer(transaction)) {
    return null;
  }

  return transaction.customer._id || transaction.customer.id || null;
}

function getCustomerQuery(customerId) {
  const query = { $or: [{ _id: customerId }] };

  if (!Number.isNaN(Number.parseInt(customerId, 10))) {
    query.$or.push({ _id: Number.parseInt(customerId, 10) });
    query.$or.push({ _id: `${customerId}` });
  }

  return query;
}

function requiresStockDeduction(transaction) {
  if (normalizeStatus(transaction.status) !== 1) {
    return false;
  }

  if (normalizeTransactionType(transaction.transaction_type) === 'refund') {
    return true;
  }

  return transaction.payment_type === 'On Account' || toCents(transaction.paid) >= toCents(transaction.total);
}

function requiresCustomerLedgerUpdate(transaction) {
  return normalizeStatus(transaction.status) === 1
    && transaction.payment_type === 'On Account'
    && hasCustomer(transaction);
}

function buildAuditEntry(existingTransaction, nextTransaction, reason) {
  return {
    from_status: existingTransaction ? normalizeStatus(existingTransaction.status) : null,
    to_status: normalizeStatus(nextTransaction.status),
    changed_at: new Date(),
    changed_by: nextTransaction.user || '',
    changed_by_id: nextTransaction.user_id || null,
    reason
  };
}

const VALID_PAYMENT_TYPES = ['Cash', 'Card', 'Cheque', 'On Account'];
const VALID_STATUSES = [0, 1, 2];
const VALID_TRANSACTION_TYPES = ['sale', 'refund'];

function validateTransaction(t) {
  const status = normalizeStatus(t.status);
  const transactionType = normalizeTransactionType(t.transaction_type);
  if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${t.status}`);
  if (t.payment_type && !VALID_PAYMENT_TYPES.includes(t.payment_type)) throw new Error(`Invalid payment_type: ${t.payment_type}`);
  if (!VALID_TRANSACTION_TYPES.includes(transactionType)) throw new Error(`Invalid transaction_type: ${t.transaction_type}`);
  if (t.total !== undefined && isNaN(Number.parseFloat(t.total))) throw new Error(`Invalid total: ${t.total}`);
  if (t.items !== undefined && (!Array.isArray(t.items) || t.items.length === 0)) throw new Error('items must be a non-empty array');
}

function prepareTransaction(existingTransaction, incomingTransaction, reason) {
  validateTransaction(incomingTransaction);

  const now = new Date();
  const nextTransaction = {
    ...incomingTransaction,
    status: normalizeStatus(incomingTransaction.status),
    transaction_type: normalizeTransactionType(incomingTransaction.transaction_type || (existingTransaction && existingTransaction.transaction_type)),
    updated_at: now
  };

  if (!existingTransaction) {
    nextTransaction.created_at = nextTransaction.created_at || now;
  } else {
    nextTransaction.created_at = existingTransaction.created_at || now;
  }

  if (nextTransaction.status === 0) {
    nextTransaction.held_at = existingTransaction && existingTransaction.held_at
      ? existingTransaction.held_at
      : (incomingTransaction.held_at || now);
  }

  if (nextTransaction.status === 1) {
    nextTransaction.completed_at = existingTransaction && existingTransaction.completed_at
      ? existingTransaction.completed_at
      : now;
    nextTransaction.completed_by = incomingTransaction.user || '';
    nextTransaction.completed_by_id = incomingTransaction.user_id || null;
  } else if (existingTransaction && existingTransaction.completed_at) {
    nextTransaction.completed_at = existingTransaction.completed_at;
    nextTransaction.completed_by = existingTransaction.completed_by;
    nextTransaction.completed_by_id = existingTransaction.completed_by_id;
  }

  if (nextTransaction.status === 2) {
    nextTransaction.voided_at = existingTransaction && existingTransaction.voided_at
      ? existingTransaction.voided_at
      : now;
  } else if (existingTransaction && existingTransaction.voided_at) {
    nextTransaction.voided_at = existingTransaction.voided_at;
  }

  const history = existingTransaction && Array.isArray(existingTransaction.status_history)
    ? existingTransaction.status_history.slice()
    : [];
  history.push(buildAuditEntry(existingTransaction, nextTransaction, reason));
  nextTransaction.status_history = history;

  return nextTransaction;
}

function findOne(db, query) {
  return new Promise((resolve, reject) => {
    db.findOne(query, (error, document) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(document);
    });
  });
}

function insertOne(db, document) {
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

function updateById(db, id, document) {
  const payload = { ...document };
  delete payload._id;

  return new Promise((resolve, reject) => {
    db.update({ _id: id }, { $set: payload }, {}, (error, updatedCount) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(updatedCount);
    });
  });
}

function removeById(db, id) {
  return new Promise((resolve, reject) => {
    db.remove({ _id: id }, {}, (error, removedCount) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(removedCount);
    });
  });
}

async function buildInventoryAdjustments(inventoryDB, transaction) {
  if (!requiresStockDeduction(transaction)) {
    return [];
  }

  const adjustments = [];
  const direction = normalizeTransactionType(transaction.transaction_type) === 'refund' ? 1 : -1;

  for (const item of transaction.items || []) {
    const productId = Number.parseInt(item.id, 10);
    if (Number.isNaN(productId)) {
      continue;
    }

    const product = await findOne(inventoryDB, { _id: productId });
    if (!product) {
      throw new Error(`Product ${productId} was not found while finalizing the sale.`);
    }

    if (Number.parseInt(product.stock, 10) !== 1) {
      continue;
    }

    const previousQuantity = Number.parseInt(product.quantity || 0, 10);
    const quantityToDeduct = Number.parseInt(item.quantity || 0, 10);
    const nextQuantity = previousQuantity + (direction * quantityToDeduct);

    if (nextQuantity < 0) {
      throw new Error(`Insufficient stock for ${product.name || productId}. Available ${previousQuantity}, requested ${quantityToDeduct}.`);
    }

    adjustments.push({
      id: productId,
      previousQuantity,
      nextQuantity
    });
  }

  return adjustments;
}

async function applyInventoryAdjustments(inventoryDB, adjustments, usePreviousValues) {
  for (const adjustment of adjustments) {
    const quantity = usePreviousValues ? adjustment.previousQuantity : adjustment.nextQuantity;
    await updateById(inventoryDB, adjustment.id, { quantity });
  }
}

async function buildCustomerAdjustment(customersDB, transaction) {
  if (!requiresCustomerLedgerUpdate(transaction)) {
    return null;
  }

  const customerId = getCustomerId(transaction);
  const customer = await findOne(customersDB, getCustomerQuery(customerId));

  if (!customer) {
    throw new Error(`Customer ${customerId} was not found while finalizing the sale.`);
  }

  const previousBalanceCents = toCents(customer.balance);
  const totalCents = toCents(transaction.total);
  const paidCents = toCents(transaction.paid);
  const incrementCents = totalCents - paidCents;

  return {
    id: customer._id,
    previousBalance: centsToAmount(previousBalanceCents),
    nextBalance: centsToAmount(previousBalanceCents + incrementCents)
  };
}

async function applyCustomerAdjustment(customersDB, adjustment, usePreviousValue) {
  if (!adjustment) {
    return;
  }

  await updateById(customersDB, adjustment.id, {
    balance: usePreviousValue ? adjustment.previousBalance : adjustment.nextBalance
  });
}

async function applyFinalizationSideEffects(transaction, inventoryDB, customersDB) {
  const inventoryAdjustments = await buildInventoryAdjustments(inventoryDB, transaction);
  const customerAdjustment = await buildCustomerAdjustment(customersDB, transaction);

  try {
    await applyInventoryAdjustments(inventoryDB, inventoryAdjustments, false);
    await applyCustomerAdjustment(customersDB, customerAdjustment, false);
  } catch (error) {
    await applyInventoryAdjustments(inventoryDB, inventoryAdjustments, true);
    await applyCustomerAdjustment(customersDB, customerAdjustment, true);
    throw error;
  }
}

module.exports = {
  applyFinalizationSideEffects,
  findOne,
  insertOne,
  normalizeStatus,
  normalizeTransactionType,
  prepareTransaction,
  removeById,
  requiresCustomerLedgerUpdate,
  requiresStockDeduction,
  toCents,
  updateById
};
