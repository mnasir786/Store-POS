const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
const Inventory = require("./inventory");
const Suppliers = require("./suppliers");

let purchasesDB = new Datastore({
    filename: paths.dbPath("purchases"),
    autoload: true
});

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
    const { supplierId, supplierName, items, notes, received_by, received_by_id } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).send("Items array is required.");
    }

    for (const item of items) {
        if (!item.productId || !item.quantity || parseInt(item.quantity) <= 0) {
            return res.status(400).send("Each item requires productId and positive quantity.");
        }
    }

    let total = 0;
    const adjustments = [];

    for (const item of items) {
        const qty = parseInt(item.quantity);
        const cost = parseFloat(item.cost_price) || 0;
        total += qty * cost;

        adjustments.push({
            productId: parseInt(item.productId),
            quantity: qty,
            cost_price: cost
        });
    }

    total = Math.round(total * 100) / 100;

    try {
        // Apply inventory updates
        for (const adj of adjustments) {
            await new Promise((resolve, reject) => {
                Inventory.db.findOne({ _id: adj.productId }, function(err, product) {
                    if (err) return reject(err);
                    if (!product) return reject(new Error("Product not found: " + adj.productId));

                    const newQty = (parseInt(product.quantity) || 0) + adj.quantity;
                    const updateFields = { quantity: newQty };
                    if (adj.cost_price > 0) updateFields.purchase_price = adj.cost_price;

                    Inventory.db.update({ _id: adj.productId }, { $set: updateFields }, {}, function(err2) {
                        if (err2) return reject(err2);
                        resolve();
                    });
                });
            });
        }

        // Update supplier balance if supplier specified
        if (supplierId) {
            await new Promise((resolve, reject) => {
                Suppliers.db.findOne({ _id: supplierId }, function(err, supplier) {
                    if (err || !supplier) return resolve(); // non-fatal
                    const newBalance = Math.round(((parseFloat(supplier.balance) || 0) + total) * 100) / 100;
                    Suppliers.db.update({ _id: supplierId }, { $set: { balance: newBalance } }, {}, function(err2) {
                        if (err2) return reject(err2);
                        resolve();
                    });
                });
            });
        }

        // Save purchase record
        const purchaseRecord = {
            _id: Math.floor(Date.now() / 1000).toString() + '_' + Math.random().toString(36).slice(2, 6),
            supplierId: supplierId || null,
            supplierName: supplierName || "Manual",
            items: adjustments,
            total,
            notes: notes || "",
            received_by: received_by || "unknown",
            received_by_id: received_by_id || 0,
            created_at: new Date().toJSON()
        };

        purchasesDB.insert(purchaseRecord, function(err) {
            if (err) return res.status(500).send("Inventory updated but failed to save purchase record: " + err);
            res.send(purchaseRecord);
        });

    } catch (err) {
        res.status(500).send(err.message || err);
    }
});
