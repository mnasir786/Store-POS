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
const settingsDB = Settings.db;
const transactionsDB = Transactions.db;

app.get("/", function(req, res) {
    res.send("Reports API");
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

            const productMap = {};
            products.forEach(p => { productMap[p._id] = p; });

            let totalSales = 0;
            let totalTransactions = transactions.length;
            let cashTotal = 0;
            let cardTotal = 0;
            let onAccountTotal = 0;
            let refillTotal = 0;
            let totalMlDispensed = 0;
            const categorySales = {};
            const productSales = {};

            transactions.forEach(t => {
                const txTotal = parseFloat(t.total) || 0;
                totalSales += txTotal;

                const pt = (t.payment_type || '').toLowerCase();
                if (pt === 'cash') cashTotal += txTotal;
                else if (pt === 'card') cardTotal += txTotal;
                else if (pt === 'on account') onAccountTotal += txTotal;

                (t.items || []).forEach(item => {
                    const qty = parseInt(item.quantity) || 1;
                    const price = parseFloat(item.price) || 0;
                    const lineTotal = qty * price;
                    const catId = item.category || 'unknown';
                    const product = productMap[item.id] || {};

                    // Category totals
                    if (!categorySales[catId]) {
                        categorySales[catId] = { category: catId, total: 0, qty: 0 };
                    }
                    categorySales[catId].total += lineTotal;
                    categorySales[catId].qty += qty;

                    // Refill total (by name match in case category ID varies)
                    if ((item.product_name || '').toLowerCase() === 'refill' || catId == '102') {
                        refillTotal += lineTotal;
                        totalMlDispensed += (parseInt(item.ml) || 0) * (parseInt(item.quantity) || 1);
                    }

                    // Product sales summary
                    const prodKey = item.id || item.product_name;
                    if (!productSales[prodKey]) {
                        productSales[prodKey] = {
                            id: item.id,
                            name: item.product_name || 'Unknown',
                            qty: 0,
                            revenue: 0,
                            totalCost: 0,
                            costPerUnit: parseFloat(product.purchase_price) || 0
                        };
                    }
                    productSales[prodKey].qty += qty;
                    productSales[prodKey].revenue += lineTotal;
                    // For refill items use ml × cost_per_ml; for regular items use qty × cost_per_unit
                    const mlDispensed = parseInt(item.ml) || 0;
                    productSales[prodKey].totalCost += mlDispensed > 0
                        ? mlDispensed * qty * (parseFloat(product.purchase_price) || 0)
                        : qty * (parseFloat(product.purchase_price) || 0);
                });
            });

            // Top 10 best sellers by qty
            const topSellers = Object.values(productSales)
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 10);

            // Profit estimate: revenue minus actual cost (ml-aware for refill items)
            const profitEstimate = Object.values(productSales).reduce((sum, p) => {
                return sum + (p.revenue - p.totalCost);
            }, 0);

            const reportData = {
                date: dateParam || new Date().toISOString().split('T')[0],
                totalSales: Math.round(totalSales * 100) / 100,
                totalTransactions,
                cashTotal: Math.round(cashTotal * 100) / 100,
                cardTotal: Math.round(cardTotal * 100) / 100,
                onAccountTotal: Math.round(onAccountTotal * 100) / 100,
                refillTotal: Math.round(refillTotal * 100) / 100,
                profitEstimate: Math.round(profitEstimate * 100) / 100,
                categorySales: Object.values(categorySales),
                topSellers,
                totalMlDispensed
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

                    const netProfit = Math.round((profitEstimate - totalExpenses) * 100) / 100;

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
