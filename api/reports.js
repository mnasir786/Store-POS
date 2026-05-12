const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
const Inventory = require("./inventory");
const ExpensesModule = require("./expenses");
const Settings = require("./settings");
const Transactions = require("./transactions");
const Categories = require("./categories");
const Purchases = require("./purchases");
const reportMetrics = require("./report-metrics");
const inventoryReportMetrics = require("./inventory-report-metrics");
const settingsDB = Settings.db;
const transactionsDB = Transactions.db;

app.get("/", function(req, res) {
    res.send("Reports API");
});

function findAll(db, query = {}) {
    return new Promise((resolve, reject) => {
        db.find(query, function(err, docs) {
            if (err) {
                reject(err);
                return;
            }
            resolve(docs || []);
        });
    });
}

app.get("/inventory", async function(req, res) {
    try {
        const [products, transactions, purchases, categories] = await Promise.all([
            findAll(Inventory.db),
            findAll(Transactions.db),
            findAll(Purchases.db),
            findAll(Categories.db)
        ]);

        const report = inventoryReportMetrics.computeInventoryReport({
            products,
            transactions,
            purchases,
            categories,
            filters: {
                start: req.query.start,
                end: req.query.end,
                category: req.query.category,
                status: req.query.status,
                search: req.query.search
            }
        });

        res.send(report);
    } catch (error) {
        res.status(500).send(error.message || error);
    }
});

app.get("/daily", function(req, res) {
    const dateParam = req.query.date;
    let startDate, endDate;

    if (dateParam) {
        startDate = new Date(dateParam);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(dateParam);
        endDate.setHours(23, 59, 59, 999);
    } else {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
    }

    transactionsDB.find({
        $and: [
            { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
            { status: 1 }
        ]
    }, function(err, transactions) {
        if (err) return res.status(500).send(err);

        Inventory.db.find({}, function(err2, products) {
            if (err2) return res.status(500).send(err2);

            const metrics = reportMetrics.buildDailySalesMetrics(transactions, products);

            const reportData = {
                date: dateParam || new Date().toISOString().split('T')[0],
                totalSales: metrics.totalSales,
                totalTransactions: metrics.totalTransactions,
                cashTotal: metrics.cashTotal,
                cardTotal: metrics.cardTotal,
                onAccountTotal: metrics.onAccountTotal,
                refillTotal: metrics.refillTotal,
                totalDiscount: metrics.totalDiscount,
                profitEstimate: metrics.profitEstimate,
                categorySales: metrics.categorySales,
                topSellers: metrics.topSellers,
                totalMlDispensed: metrics.totalMlDispensed
            };

            settingsDB.findOne({ _id: 2 }, function(err3, cfg) {
                const liquidId = cfg && parseInt(cfg.liquid_product_id);

                // Fetch expenses for this day
                ExpensesModule.db.find({
                    date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }
                }, function(errE, expenses) {
                    const totalExpenses = Math.round(
                        (expenses || []).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0) * 100
                    ) / 100;

                    const netProfit = Math.round((metrics.profitEstimate - totalExpenses) * 100) / 100;

                    const fullReport = Object.assign({}, reportData, {
                        totalExpenses,
                        netProfit,
                        expenses: expenses || []
                    });

                    if (!liquidId) return res.send(Object.assign({}, fullReport, { currentMlStock: null }));
                    Inventory.db.findOne({ _id: liquidId }, function(err4, product) {
                        const currentMlStock = product != null ? (parseInt(product.quantity) || 0) : null;
                        res.send(Object.assign({}, fullReport, { currentMlStock }));
                    });
                });
            });
        });
    });
});
