const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const ledgerService = require("./supplier-ledger-service");
const Inventory = require("./inventory");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
let suppliersDB = new Datastore({
    filename: paths.dbPath("suppliers"),
    autoload: true
});

let supplierPaymentsDB = new Datastore({
    filename: paths.dbPath("supplier_payments"),
    autoload: true
});

let supplierLedgerDB = new Datastore({
    filename: paths.dbPath("supplier_ledger"),
    autoload: true
});

app.db = suppliersDB;
app.paymentsDb = supplierPaymentsDB;
app.ledgerDb = supplierLedgerDB;

suppliersDB.ensureIndex({ fieldName: '_id', unique: true });

function findSupplierById(supplierId, callback) {
    suppliersDB.findOne({ _id: supplierId }, callback);
}

app.get("/", function(req, res) {
    res.send("Suppliers API");
});

app.get("/all", function(req, res) {
    suppliersDB.find({ status: { $ne: "inactive" } }, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs);
    });
});

app.get("/supplier/:id", function(req, res) {
    suppliersDB.findOne({ _id: req.params.id }, function(err, doc) {
        if (err) return res.status(500).send(err);
        if (!doc) return res.status(404).send("Supplier not found.");
        res.send(doc);
    });
});

app.post("/supplier", function(req, res) {
    const { _id, name, phone, email } = req.body;

    if (!name) return res.status(400).send("Supplier name is required.");

    if (_id) {
        suppliersDB.update({ _id }, { $set: { name, phone: phone || "", email: email || "" } }, {}, function(err, n) {
            if (err) return res.status(500).send(err);
            if (n === 0) return res.status(404).send("Supplier not found.");
            res.sendStatus(200);
        });
    } else {
        const newSupplier = {
            _id: Math.floor(Date.now() / 1000).toString(),
            name,
            phone: phone || "",
            email: email || "",
            balance: 0,
            status: "active",
            created_at: new Date().toJSON()
        };
        suppliersDB.insert(newSupplier, function(err, doc) {
            if (err) return res.status(500).send(err);
            res.send(doc);
        });
    }
});

app.delete("/supplier/:id", function(req, res) {
    suppliersDB.update({ _id: req.params.id }, { $set: { status: "inactive" } }, {}, function(err, n) {
        if (err) return res.status(500).send(err);
        if (n === 0) return res.status(404).send("Supplier not found.");
        res.sendStatus(200);
    });
});

app.post("/pay", function(req, res) {
    const { supplierId, amount, note, reference, paid_by, paid_by_id } = req.body;
    if (!supplierId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).send("Valid supplierId and positive amount required.");
    }

    findSupplierById(supplierId, async function(err, supplier) {
        if (err) return res.status(500).send(err);
        if (!supplier) return res.status(404).send("Supplier not found.");

        try {
            const payment = await ledgerService.recordSupplierPayment(suppliersDB, supplierPaymentsDB, supplier, {
                amount,
                note,
                reference,
                paidBy: paid_by,
                paidById: paid_by_id
            });
            res.send(payment);
        } catch (error) {
            res.status(500).send(error.message || error);
        }
    });
});

app.post("/ledger-entry", function(req, res) {
    const { supplierId, entryType, amount, reference, effectiveAt, note, createdBy, createdById } = req.body;

    if (!supplierId) {
        return res.status(400).send("Supplier id is required.");
    }

    findSupplierById(supplierId, async function(err, supplier) {
        if (err) return res.status(500).send(err);
        if (!supplier) return res.status(404).send("Supplier not found.");

        try {
            const entry = await ledgerService.recordManualLedgerEntry(suppliersDB, supplierLedgerDB, supplier, {
                entryType,
                amount,
                reference,
                effectiveAt,
                note,
                createdBy,
                createdById
            });

            res.send({
                entry,
                balance: entry.balance_after
            });
        } catch (error) {
            res.status(500).send(error.message || error);
        }
    });
});

app.get("/payments/all", function(req, res) {
    supplierPaymentsDB.find({}, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

app.get("/ledger/:supplierId/statement", function(req, res) {
    const supplierId = req.params.supplierId;

    findSupplierById(supplierId, async function(err, supplier) {
        if (err) return res.status(500).send(err);
        if (!supplier) return res.status(404).send("Supplier not found.");

        const Purchases = require("./purchases");
        try {
            const [purchases, payments, manualEntries, products] = await Promise.all([
                new Promise((resolve, reject) => {
                    Purchases.db.find({}, function(error, docs) {
                        if (error) return reject(error);
                        resolve(docs || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    supplierPaymentsDB.find({}, function(error, docs) {
                        if (error) return reject(error);
                        resolve(docs || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    supplierLedgerDB.find({}, function(error, docs) {
                        if (error) return reject(error);
                        resolve(docs || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    Inventory.db.find({}, function(error, docs) {
                        if (error) return reject(error);
                        resolve(docs || []);
                    });
                })
            ]);

            const statement = ledgerService.buildSupplierStatement({
                supplier,
                purchases,
                payments,
                manualEntries,
                products
            });

            res.send(statement);
        } catch (error) {
            res.status(500).send(error.message || error);
        }
    });
});
