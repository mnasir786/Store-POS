const transactionService = require('./transaction-service');

const { toCents } = transactionService;

function centsToAmount(cents) {
  return Math.round(cents) / 100;
}

function normalizeMoney(value) {
  return centsToAmount(toCents(value));
}

function updateById(db, id, updateFields) {
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

function removeById(db, id) {
  return new Promise((resolve, reject) => {
    db.remove({ _id: id }, {}, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function validateItems(items) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required.');
  }

  items.forEach(item => {
    if (!item.productId || !item.quantity || parseInt(item.quantity, 10) <= 0) {
      throw new Error('Each item requires productId and positive quantity.');
    }
  });
}

function validateReceivingPayload(payload) {
  if (!payload || !payload.supplierId) {
    throw new Error('Supplier is required for stock receiving.');
  }

  if (toCents(payload.invoice_total) <= 0) {
    throw new Error('Invoice total is required for stock receiving.');
  }
}

function buildPurchaseAmounts(items, invoiceTotal, paidNow) {
  const lineTotalCents = items.reduce((sum, item) => {
    const qty = Number.parseInt(item.quantity, 10) || 0;
    const costCents = toCents(item.cost_price);
    return sum + (qty * costCents);
  }, 0);

  const invoiceTotalCents = toCents(invoiceTotal);
  const paidNowCents = toCents(paidNow);
  const purchaseTotalCents = invoiceTotalCents > 0 ? invoiceTotalCents : lineTotalCents;

  if (paidNowCents < 0) {
    throw new Error('Paid now amount cannot be negative.');
  }

  if (purchaseTotalCents < 0) {
    throw new Error('Purchase total cannot be negative.');
  }

  if (invoiceTotalCents > 0 && lineTotalCents !== invoiceTotalCents) {
    throw new Error('Line item total must exactly match the supplier invoice total.');
  }

  if (paidNowCents > purchaseTotalCents) {
    throw new Error('Paid now amount cannot exceed the purchase total.');
  }

  return {
    lineTotal: centsToAmount(lineTotalCents),
    invoiceTotal: centsToAmount(invoiceTotalCents),
    purchaseTotal: centsToAmount(purchaseTotalCents),
    paidNow: centsToAmount(paidNowCents),
    outstanding: centsToAmount(purchaseTotalCents - paidNowCents)
  };
}

async function receiveStock({
  inventoryDb,
  purchasesDb,
  suppliersDb,
  supplierPaymentsDb,
  payload
}) {
  validateReceivingPayload(payload);
  validateItems(payload.items);

  const amounts = buildPurchaseAmounts(payload.items, payload.invoice_total, payload.paid_now);
  const adjustments = [];

  for (const item of payload.items) {
    const productId = parseInt(item.productId, 10);
    const product = await findOne(inventoryDb, { _id: productId });
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    adjustments.push({
      productId,
      previousQuantity: parseInt(product.quantity, 10) || 0,
      previousPurchasePrice: normalizeMoney(product.purchase_price),
      nextQuantity: (parseInt(product.quantity, 10) || 0) + (parseInt(item.quantity, 10) || 0),
      nextPurchasePrice: (parseFloat(item.cost_price) || 0) > 0
        ? normalizeMoney(item.cost_price)
        : normalizeMoney(product.purchase_price)
    });
  }

  let supplier = null;
  let previousSupplierBalance = 0;
  if (payload.supplierId) {
    supplier = await findOne(suppliersDb, { _id: payload.supplierId });
    if (!supplier) {
      throw new Error('Supplier not found.');
    }
    previousSupplierBalance = normalizeMoney(supplier.balance);
  }

  const now = new Date().toISOString();
  const purchaseRecord = {
    _id: Math.floor(Date.now() / 1000).toString() + '_' + Math.random().toString(36).slice(2, 6),
    supplierId: payload.supplierId || null,
    supplierName: payload.supplierName || 'Manual',
    items: payload.items.map(item => ({
      productId: parseInt(item.productId, 10),
      quantity: parseInt(item.quantity, 10) || 0,
      cost_price: normalizeMoney(item.cost_price)
    })),
    line_total: amounts.lineTotal,
    invoice_total: amounts.invoiceTotal,
    total: amounts.purchaseTotal,
    paid_now: amounts.paidNow,
    outstanding: amounts.outstanding,
    notes: payload.notes || '',
    received_by: payload.received_by || 'unknown',
    received_by_id: payload.received_by_id || 0,
    created_at: now
  };

  let paymentRecord = null;

  try {
    for (const adjustment of adjustments) {
      const updateFields = {
        quantity: adjustment.nextQuantity
      };

      if ((Number.parseFloat(adjustment.nextPurchasePrice) || 0) > 0) {
        updateFields.purchase_price = adjustment.nextPurchasePrice;
      }

      await updateById(inventoryDb, adjustment.productId, updateFields);
    }

    if (supplier) {
      const nextBalance = normalizeMoney(previousSupplierBalance + amounts.outstanding);
      await updateById(suppliersDb, supplier._id, { balance: nextBalance });
    }

    await insertOne(purchasesDb, purchaseRecord);

    if (supplier && amounts.paidNow > 0) {
      paymentRecord = {
        _id: `${Date.now()}_${supplier._id}_${Math.round(Math.random() * 100000)}`,
        supplierId: supplier._id,
        supplierName: supplier.name,
        amount: amounts.paidNow,
        note: payload.notes || 'Auto settlement during stock receiving',
        reference: purchaseRecord._id,
        created_at: now,
        paid_by: payload.received_by || 'unknown',
        paid_by_id: payload.received_by_id || 0,
        balance_before: normalizeMoney(previousSupplierBalance + amounts.purchaseTotal),
        balance_after: normalizeMoney(previousSupplierBalance + amounts.outstanding),
        purchase_id: purchaseRecord._id
      };

      await insertOne(supplierPaymentsDb, paymentRecord);
    }
  } catch (error) {
    for (const adjustment of adjustments) {
      const rollbackFields = {
        quantity: adjustment.previousQuantity,
        purchase_price: adjustment.previousPurchasePrice
      };
      await updateById(inventoryDb, adjustment.productId, rollbackFields).catch(() => {});
    }

    if (supplier) {
      await updateById(suppliersDb, supplier._id, { balance: previousSupplierBalance }).catch(() => {});
    }

    if (paymentRecord) {
      await removeById(supplierPaymentsDb, paymentRecord._id).catch(() => {});
    }

    await removeById(purchasesDb, purchaseRecord._id).catch(() => {});
    throw error;
  }

  return {
    purchase: purchaseRecord,
    payment: paymentRecord,
    totals: amounts
  };
}

module.exports = {
  buildPurchaseAmounts,
  receiveStock
};
