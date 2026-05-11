let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("@seald-io/nedb");
let Inventory = require("./inventory");
let transactionService = require("./transaction-service");
const Settings = require("./settings");
const queryUtils = require("./transaction-query-utils");

app.use(bodyParser.json());

const paths = require("./path-helper");
let transactionsDB = new Datastore({
  filename: paths.dbPath("transactions"),
  autoload: true
});

const settingsDB = Settings.db;

app.db = transactionsDB;
module.exports = app;


transactionsDB.ensureIndex({ fieldName: '_id', unique: true });

app.get("/", function(req, res) {
  res.send("Transactions API");
});

 
app.get("/all", function(req, res) {
  transactionsDB.find({}, function(err, docs) {
    res.send(docs);
  });
});



 
app.get("/on-hold", function(req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: {$ne: ""}}, { status: 0  }]},    
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/customer-orders", function(req, res) {
  transactionsDB.find(
    { $and: [{ customer: {$ne: "0"} }, { status: 0}, { ref_number: ""}]},
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/by-date", function(req, res) {

  let startDate = new Date(req.query.start);
  let endDate = new Date(req.query.end);

  if(req.query.user == 0 && req.query.till == 0) {
      transactionsDB.find(
        { $and: [{ date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }}, { status: parseInt(req.query.status) }] },
        function(err, docs) {
          if (docs) res.send(docs);
        }
      );
  }

  if(req.query.user != 0 && req.query.till == 0) {
    transactionsDB.find(
      { $and: [{ date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }}, { status: parseInt(req.query.status) }, { user_id: parseInt(req.query.user) }] },
      function(err, docs) {
        if (docs) res.send(docs);
      }
    );
  }

  if(req.query.user == 0 && req.query.till != 0) {
    transactionsDB.find(
      { $and: [{ date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }}, { status: parseInt(req.query.status) }, { till: parseInt(req.query.till) }] },
      function(err, docs) {
        if (docs) res.send(docs);
      }
    );
  }

  if(req.query.user != 0 && req.query.till != 0) {
    transactionsDB.find(
      { $and: [{ date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }}, { status: parseInt(req.query.status) }, { till: parseInt(req.query.till) }, { user_id: parseInt(req.query.user) }] },
      function(err, docs) {
        if (docs) res.send(docs);
      }
    );
  }

});



let Customers = require("./customers");

function roundCurrency(value) {
  return Math.round((Number.parseFloat(value) || 0) * 100) / 100;
}

function getRefundSign(transaction) {
  return transactionService.normalizeTransactionType(transaction.transaction_type) === 'refund' ? -1 : 1;
}

function getItemKey(item) {
  return `${item.id}::${item.product_name || ''}`;
}

function buildRefundedQuantityMap(refundTransactions) {
  const refundedMap = {};

  refundTransactions.forEach(refundTransaction => {
    (refundTransaction.items || []).forEach(item => {
      const key = getItemKey(item);
      refundedMap[key] = (refundedMap[key] || 0) + (Number.parseInt(item.quantity, 10) || 0);
    });
  });

  return refundedMap;
}

async function findRefundTransactions(originalTransactionId) {
  return new Promise((resolve, reject) => {
    transactionsDB.find(queryUtils.buildReferenceIdQuery('refund_of', originalTransactionId), (error, docs) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(docs || []);
    });
  });
}

function buildRefundSummary(originalTransaction, refundTransactions) {
  const refundedQuantityMap = buildRefundedQuantityMap(refundTransactions);

  const items = (originalTransaction.items || []).map(item => {
    const soldQty = Number.parseInt(item.quantity, 10) || 0;
    const refundedQty = refundedQuantityMap[getItemKey(item)] || 0;
    return {
      id: item.id,
      product_name: item.product_name,
      category: item.category,
      price: Number.parseFloat(item.price) || 0,
      quantity_sold: soldQty,
      quantity_refunded: refundedQty,
      quantity_remaining: Math.max(0, soldQty - refundedQty),
      ml: Number.parseInt(item.ml, 10) || 0,
      sku: item.sku || ''
    };
  });

  return {
    original: originalTransaction,
    items,
    fullyRefunded: items.every(item => item.quantity_remaining === 0),
    refundCount: refundTransactions.length
  };
}

function allocateRefundAmounts(originalTransaction, selectedItems) {
  const grossOriginalSubtotal = roundCurrency(
    (originalTransaction.items || []).reduce((sum, item) => {
      return sum + ((Number.parseInt(item.quantity, 10) || 0) * (Number.parseFloat(item.price) || 0));
    }, 0)
  );

  const selectedGrossSubtotal = roundCurrency(
    selectedItems.reduce((sum, item) => {
      return sum + ((Number.parseInt(item.quantity, 10) || 0) * (Number.parseFloat(item.price) || 0));
    }, 0)
  );

  const originalDiscount = roundCurrency(originalTransaction.discount);
  const originalNetSubtotal = roundCurrency(originalTransaction.subtotal);
  const originalTax = roundCurrency(originalTransaction.tax);

  const refundDiscount = grossOriginalSubtotal > 0
    ? roundCurrency(originalDiscount * (selectedGrossSubtotal / grossOriginalSubtotal))
    : 0;

  const refundNetSubtotal = roundCurrency(selectedGrossSubtotal - refundDiscount);
  const refundTax = originalNetSubtotal > 0
    ? roundCurrency(originalTax * (refundNetSubtotal / originalNetSubtotal))
    : 0;
  const refundTotal = roundCurrency(refundNetSubtotal + refundTax);

  return {
    refundDiscount,
    refundNetSubtotal,
    refundTax,
    refundTotal
  };
}

async function adjustRefillMl(transaction, inventoryDB) {
  if (transactionService.normalizeStatus(transaction.status) !== 1) return;

  const refillItems = (transaction.items || []).filter(item =>
    parseInt(item.ml) > 0 && String(item.id).startsWith('refill_')
  );
  if (refillItems.length === 0) return;

  const totalMl = refillItems.reduce((sum, item) =>
    sum + (parseInt(item.ml) || 0) * (parseInt(item.quantity) || 1), 0);
  if (totalMl <= 0) return;

  const cfg = await new Promise(resolve => settingsDB.findOne({ _id: 2 }, (e, d) => resolve(d)));
  const liquidId = cfg && parseInt(cfg.liquid_product_id);
  if (!liquidId) return;

  await new Promise(resolve => {
    inventoryDB.findOne({ _id: liquidId }, function(err, product) {
      if (err || !product) return resolve();
      const direction = transactionService.normalizeTransactionType(transaction.transaction_type) === 'refund' ? 1 : -1;
      const newQty = Math.max(0, (parseInt(product.quantity) || 0) + (direction * totalMl));
      inventoryDB.update({ _id: liquidId }, { $set: { quantity: newQty } }, {}, resolve);
    });
  });
}

app.post("/new", async function(req, res) {
  let newTransaction = transactionService.prepareTransaction(null, req.body, "created");
  let inserted = false;

  try {
    await transactionService.insertOne(transactionsDB, newTransaction);
    inserted = true;
    await transactionService.applyFinalizationSideEffects(newTransaction, Inventory.db, Customers.db);
    await adjustRefillMl(newTransaction, Inventory.db);
    res.sendStatus(200);
  } catch (error) {
    if (inserted) {
      await transactionService.removeById(transactionsDB, newTransaction._id).catch(() => {});
    }
    res.status(500).send(error.message || error);
  }
});



app.put("/new", async function(req, res) {
  let orderId = req.body._id;

  try {
    const existingTransaction = await transactionService.findOne(transactionsDB, { _id: orderId });

    if (!existingTransaction) {
      res.status(404).send("Held order was not found.");
      return;
    }

    if (transactionService.normalizeStatus(existingTransaction.status) !== 0) {
      res.status(409).send("Only held orders can be updated or finalized.");
      return;
    }

    const nextStatus = transactionService.normalizeStatus(req.body.status);
    if (nextStatus !== 0 && nextStatus !== 1) {
      res.status(400).send("Held orders can only stay on hold or be finalized.");
      return;
    }

    const nextTransaction = transactionService.prepareTransaction(existingTransaction, req.body, "updated");
    await transactionService.updateById(transactionsDB, orderId, nextTransaction);

    try {
      await transactionService.applyFinalizationSideEffects(nextTransaction, Inventory.db, Customers.db);
      await adjustRefillMl(nextTransaction, Inventory.db);
    } catch (error) {
      await transactionService.updateById(transactionsDB, orderId, existingTransaction).catch(() => {});
      throw error;
    }

    res.sendStatus(200);
  } catch (error) {
    res.status(500).send(error.message || error);
  }
});


app.post( "/delete", function ( req, res ) {
  let transactionId = req.body.orderId;
  transactionService.findOne(transactionsDB, { _id: transactionId }).then(existingTransaction => {
    if (!existingTransaction) {
      res.status(404).send("Held order was not found.");
      return;
    }

    if (transactionService.normalizeStatus(existingTransaction.status) !== 0) {
      res.status(409).send("Only held orders can be voided from the hold-order screen.");
      return;
    }

    const voidedTransaction = transactionService.prepareTransaction(existingTransaction, {
      ...existingTransaction,
      status: 2
    }, "voided");

    return transactionService.updateById(transactionsDB, transactionId, voidedTransaction).then(() => {
      res.sendStatus(200);
    });
  }).catch(err => {
    res.status(500).send(err.message || err);
  });
} );

app.get("/:transactionId/refund-summary", async function(req, res) {
  try {
    const transactionId = req.params.transactionId;
    const originalTransaction = await transactionService.findOne(transactionsDB, queryUtils.buildTransactionIdQuery(transactionId));

    if (!originalTransaction) {
      res.status(404).send("Transaction was not found.");
      return;
    }

    if (transactionService.normalizeStatus(originalTransaction.status) !== 1
      || transactionService.normalizeTransactionType(originalTransaction.transaction_type) === 'refund') {
      res.status(409).send("Only completed sales can be refunded.");
      return;
    }

    const refundTransactions = await findRefundTransactions(transactionId);
    res.send(buildRefundSummary(originalTransaction, refundTransactions));
  } catch (error) {
    res.status(500).send(error.message || error);
  }
});

app.post("/refund", async function(req, res) {
  try {
    const originalTransaction = await transactionService.findOne(transactionsDB, queryUtils.buildTransactionIdQuery(req.body.transactionId));

    if (!originalTransaction) {
      res.status(404).send("Original transaction was not found.");
      return;
    }

    if (transactionService.normalizeStatus(originalTransaction.status) !== 1
      || transactionService.normalizeTransactionType(originalTransaction.transaction_type) === 'refund') {
      res.status(409).send("Only completed sales can be refunded.");
      return;
    }

    const refundTransactions = await findRefundTransactions(req.body.transactionId);
    const refundSummary = buildRefundSummary(originalTransaction, refundTransactions);
    const summaryMap = {};
    refundSummary.items.forEach(item => {
      summaryMap[`${item.id}::${item.product_name}`] = item;
    });

    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (requestedItems.length === 0) {
      res.status(400).send("Please select at least one item to refund.");
      return;
    }

    const selectedItems = [];
    for (const requestedItem of requestedItems) {
      const key = `${requestedItem.id}::${requestedItem.product_name || ''}`;
      const originalItem = summaryMap[key];
      const refundQty = Number.parseInt(requestedItem.quantity, 10) || 0;

      if (!originalItem) {
        res.status(400).send("One or more selected refund items do not belong to the original sale.");
        return;
      }

      if (refundQty <= 0) {
        res.status(400).send("Refund quantities must be greater than zero.");
        return;
      }

      if (refundQty > originalItem.quantity_remaining) {
        res.status(409).send(`Refund quantity for ${originalItem.product_name} exceeds remaining refundable quantity.`);
        return;
      }

      selectedItems.push({
        id: originalItem.id,
        product_name: originalItem.product_name,
        category: originalItem.category,
        price: originalItem.price,
        quantity: refundQty,
        ml: originalItem.ml,
        sku: originalItem.sku
      });
    }

    const paymentType = req.body.payment_type || originalTransaction.payment_type;
    if (paymentType === 'On Account' && !originalTransaction.customer) {
      res.status(400).send("On-account refunds require a customer on the original sale.");
      return;
    }

    const allocation = allocateRefundAmounts(originalTransaction, selectedItems);
    if (allocation.refundTotal <= 0) {
      res.status(400).send("Calculated refund amount is invalid.");
      return;
    }

    const refundId = Math.floor(Date.now() / 1000);
    const refundTransaction = transactionService.prepareTransaction(null, {
      _id: refundId,
      order: refundId,
      ref_number: `REFUND-${originalTransaction.order}`,
      transaction_type: 'refund',
      refund_of: originalTransaction._id,
      refund_reason: (req.body.reason || '').trim(),
      customer: originalTransaction.customer,
      status: 1,
      subtotal: (-allocation.refundNetSubtotal).toFixed(2),
      discount: allocation.refundDiscount.toFixed(2),
      tax: (-allocation.refundTax).toFixed(2),
      order_type: originalTransaction.order_type || 1,
      items: selectedItems,
      date: req.body.date || new Date(),
      payment_type: paymentType,
      payment_info: req.body.payment_info || '',
      total: (-allocation.refundTotal).toFixed(2),
      paid: paymentType === 'On Account' ? '' : (-allocation.refundTotal).toFixed(2),
      change: '0.00',
      till: req.body.till || originalTransaction.till || null,
      mac: req.body.mac || originalTransaction.mac || null,
      user: req.body.user || '',
      user_id: req.body.user_id || null
    }, 'refund');

    await transactionService.insertOne(transactionsDB, refundTransaction);

    try {
      await transactionService.applyFinalizationSideEffects(refundTransaction, Inventory.db, Customers.db);
      await adjustRefillMl(refundTransaction, Inventory.db);
    } catch (error) {
      await transactionService.removeById(transactionsDB, refundTransaction._id).catch(() => {});
      throw error;
    }

    res.send(refundTransaction);
  } catch (error) {
    res.status(500).send(error.message || error);
  }
});



app.get("/:transactionId", function(req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function(err, doc) {
    if (doc) res.send(doc[0]);
  });
});
