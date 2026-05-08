const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");

app.use(bodyParser.json());
module.exports = app;

// Expose db so reports.js can query it directly
const paths = require("./path-helper");

const db = new Datastore({
    filename: paths.dbPath("expenses"),
    autoload: true
});

db.ensureIndex({ fieldName: '_id', unique: true });

// Export db for use in reports.js
app.db = db;
module.exports.db = db;

app.get("/", function(req, res) {
    res.send("Expenses API");
});

// GET all expenses (sorted newest first)
app.get("/all", function(req, res) {
    db.find({}, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

// GET expenses within a date range: /range?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get("/range", function(req, res) {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).send("start and end date required");

    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    db.find({
        date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }
    }, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

// POST add new expense
app.post("/", function(req, res) {
    const { category, amount, notes, date } = req.body;

    if (!category || !amount) {
        return res.status(400).send("Category and amount are required.");
    }

    const amountNum = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).send("Amount must be a positive number.");
    }

    // Use provided date or today
    const expenseDate = date ? new Date(date) : new Date();
    expenseDate.setHours(12, 0, 0, 0); // Noon to avoid timezone edge cases

    const record = {
        _id: Math.floor(Date.now() / 1000).toString() + '_' + Math.random().toString(36).slice(2, 6),
        category: category.trim(),
        amount: amountNum,
        notes: (notes || "").trim(),
        date: expenseDate.toJSON(),
        created_at: new Date().toJSON()
    };

    db.insert(record, function(err, newDoc) {
        if (err) return res.status(500).send(err);
        res.send(newDoc);
    });
});

// DELETE an expense by id
app.delete("/:id", function(req, res) {
    const id = req.params.id;
    db.remove({ _id: id }, {}, function(err, numRemoved) {
        if (err) return res.status(500).send(err);
        if (numRemoved === 0) return res.status(404).send("Expense not found.");
        res.send({ success: true, id });
    });
});
