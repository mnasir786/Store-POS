const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
let suppliersDB = new Datastore({
    filename: paths.dbPath("suppliers"),
    autoload: true
});

app.db = suppliersDB;

suppliersDB.ensureIndex({ fieldName: '_id', unique: true });

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
    const { supplierId, amount } = req.body;
    if (!supplierId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).send("Valid supplierId and positive amount required.");
    }

    const payAmt = parseFloat(amount);
    suppliersDB.findOne({ _id: supplierId }, function(err, supplier) {
        if (err) return res.status(500).send(err);
        if (!supplier) return res.status(404).send("Supplier not found.");
        const newBalance = Math.round((parseFloat(supplier.balance || 0) - payAmt) * 100) / 100;
        suppliersDB.update({ _id: supplierId }, { $set: { balance: newBalance } }, {}, function(err2) {
            if (err2) return res.status(500).send(err2);
            res.sendStatus(200);
        });
    });
});
