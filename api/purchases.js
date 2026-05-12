const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
const Inventory = require("./inventory");
const Suppliers = require("./suppliers");
const purchaseReceivingService = require("./purchase-receiving-service");

let purchasesDB = new Datastore({
    filename: paths.dbPath("purchases"),
    autoload: true
});

app.db = purchasesDB;

purchasesDB.ensureIndex({ fieldName: '_id', unique: true });

app.get("/", function(req, res) {
    res.send("Purchases API");
});

app.get("/all", function(req, res) {
    purchasesDB.find({}, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

app.post("/receive", async function(req, res) {
    try {
        const result = await purchaseReceivingService.receiveStock({
            inventoryDb: Inventory.db,
            purchasesDb,
            suppliersDb: Suppliers.db,
            supplierPaymentsDb: Suppliers.paymentsDb,
            payload: req.body
        });

        res.send(result.purchase);
    } catch (err) {
        const message = err && err.message ? err.message : err;
        if (/required|cannot|not found|exceed|match/i.test(message)) {
            res.status(400).send(message);
            return;
        }

        res.status(500).send(message);
    }
});
