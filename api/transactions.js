let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("@seald-io/nedb");
let Inventory = require("./inventory");
let transactionService = require("./transaction-service");

app.use(bodyParser.json());

module.exports = app;
 
const paths = require("./path-helper");
let transactionsDB = new Datastore({
  filename: paths.dbPath("transactions"),
  autoload: true
});

const settingsDB = new Datastore({ filename: paths.dbPath("settings"), autoload: true });


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

async function deductRefillMl(transaction, inventoryDB) {
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
      const newQty = Math.max(0, (parseInt(product.quantity) || 0) - totalMl);
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
    await deductRefillMl(newTransaction, Inventory.db);
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
      await deductRefillMl(nextTransaction, Inventory.db);
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



app.get("/:transactionId", function(req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function(err, doc) {
    if (doc) res.send(doc[0]);
  });
});
