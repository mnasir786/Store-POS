const test = require('node:test');
const assert = require('node:assert/strict');

const inventoryReportMetrics = require('../api/inventory-report-metrics');

test('inventory report totals current stock valuation and potential retail value', () => {
  const report = inventoryReportMetrics.computeInventoryReport({
    products: [
      { _id: 1, name: 'XROS 5', brand: 'Vaporesso', category: 104, quantity: 2, stock: 1, purchase_price: 8000, price: 10500, min_stock: 1, barcode: 'ABC' },
      { _id: 2, name: 'Classic Series', flavor: 'Mango', category: 103, quantity: 3, stock: 1, purchase_price: 1800, price: 2800, min_stock: 2, barcode: 'DEF' }
    ],
    transactions: [],
    purchases: [],
    categories: [
      { _id: 103, name: 'Liquid' },
      { _id: 104, name: 'Devices' }
    ],
    filters: { start: '2026-05-01', end: '2026-05-30', category: '0', status: 'all', search: '' }
  });

  assert.equal(report.summary.totalSkus, 2);
  assert.equal(report.summary.totalUnits, 5);
  assert.equal(report.summary.inventoryCostValue, 21400);
  assert.equal(report.summary.inventoryRetailValue, 29400);
  assert.equal(report.summary.potentialGrossProfit, 8000);
});

test('inventory report applies discounted sale and refund to movement metrics', () => {
  const report = inventoryReportMetrics.computeInventoryReport({
    products: [
      { _id: 2, name: 'Classic Series', flavor: 'Mango', category: 103, quantity: 3, stock: 1, purchase_price: 1800, price: 2800, min_stock: 2 }
    ],
    transactions: [
      {
        _id: 10,
        status: 1,
        payment_type: 'Cash',
        total: '2700.00',
        discount: '100.00',
        date: '2026-05-12T09:00:00.000Z',
        items: [{ id: 2, product_name: 'Classic Series', product_display_name: 'Classic Series | Mango', quantity: 1, price: 2800, category: 103 }]
      },
      {
        _id: 11,
        status: 1,
        payment_type: 'Cash',
        transaction_type: 'refund',
        total: '-2700.00',
        discount: '100.00',
        date: '2026-05-13T09:00:00.000Z',
        items: [{ id: 2, product_name: 'Classic Series', product_display_name: 'Classic Series | Mango', quantity: 1, price: 2800, category: 103 }]
      }
    ],
    purchases: [],
    categories: [{ _id: 103, name: 'Liquid' }],
    filters: { start: '2026-05-01', end: '2026-05-30', category: '0', status: 'all', search: '' }
  });

  const row = report.rows[0];
  assert.equal(row.unitsSoldWindow, 0);
  assert.equal(row.revenueWindow, 0);
  assert.equal(row.movementStatus, 'dead_stock');
});

test('inventory report resolves low stock, out of stock, dead stock, and slow moving states', () => {
  const report = inventoryReportMetrics.computeInventoryReport({
    products: [
      { _id: 1, name: 'Low Item', category: 103, quantity: 2, stock: 1, purchase_price: 100, price: 200, min_stock: 2 },
      { _id: 2, name: 'Out Item', category: 103, quantity: 0, stock: 1, purchase_price: 100, price: 200, min_stock: 2 },
      { _id: 3, name: 'Dead Item', category: 103, quantity: 5, stock: 1, purchase_price: 100, price: 200, min_stock: 1 },
      { _id: 4, name: 'Slow Item', category: 103, quantity: 5, stock: 1, purchase_price: 100, price: 200, min_stock: 3 }
    ],
    transactions: [
      {
        _id: 20,
        status: 1,
        payment_type: 'Cash',
        total: '200.00',
        discount: '0.00',
        date: '2026-05-12T09:00:00.000Z',
        items: [{ id: 4, product_name: 'Slow Item', quantity: 1, price: 200, category: 103 }]
      }
    ],
    purchases: [],
    categories: [{ _id: 103, name: 'Liquid' }],
    filters: { start: '2026-05-01', end: '2026-05-30', category: '0', status: 'all', search: '' }
  });

  const rowByName = Object.fromEntries(report.rows.map(row => [row.productName, row]));
  assert.equal(rowByName['Low Item'].stockStatus, 'low_stock');
  assert.equal(rowByName['Out Item'].stockStatus, 'out_of_stock');
  assert.equal(rowByName['Dead Item'].movementStatus, 'dead_stock');
  assert.equal(rowByName['Slow Item'].movementStatus, 'slow_moving');
  assert.equal(report.summary.lowStockCount, 1);
  assert.equal(report.summary.outOfStockCount, 1);
  assert.equal(report.summary.deadStockCount, 2);
  assert.equal(report.summary.slowMovingCount, 1);
});

test('inventory report returns last sold and last received dates', () => {
  const report = inventoryReportMetrics.computeInventoryReport({
    products: [
      { _id: 1, name: 'Tracked Item', category: 103, quantity: 4, stock: 1, purchase_price: 100, price: 200, min_stock: 1 }
    ],
    transactions: [
      {
        _id: 21,
        status: 1,
        payment_type: 'Cash',
        total: '200.00',
        discount: '0.00',
        date: '2026-05-10T09:00:00.000Z',
        items: [{ id: 1, product_name: 'Tracked Item', quantity: 1, price: 200, category: 103 }]
      },
      {
        _id: 22,
        status: 1,
        payment_type: 'Cash',
        total: '400.00',
        discount: '0.00',
        date: '2026-05-12T09:00:00.000Z',
        items: [{ id: 1, product_name: 'Tracked Item', quantity: 2, price: 200, category: 103 }]
      }
    ],
    purchases: [
      { _id: 'p1', created_at: '2026-05-01T09:00:00.000Z', items: [{ productId: 1, quantity: 2, cost_price: 90 }] },
      { _id: 'p2', created_at: '2026-05-11T09:00:00.000Z', items: [{ productId: 1, quantity: 2, cost_price: 100 }] }
    ],
    categories: [{ _id: 103, name: 'Liquid' }],
    filters: { start: '2026-05-01', end: '2026-05-30', category: '0', status: 'all', search: '' }
  });

  assert.equal(report.rows[0].lastSoldDate, '2026-05-12T09:00:00.000Z');
  assert.equal(report.rows[0].lastReceivedDate, '2026-05-11T09:00:00.000Z');
});

test('inventory report search and category filters narrow rows', () => {
  const report = inventoryReportMetrics.computeInventoryReport({
    products: [
      { _id: 1, name: 'XROS 5', brand: 'Vaporesso', category: 104, quantity: 2, stock: 1, purchase_price: 100, price: 200, min_stock: 1, barcode: 'X001' },
      { _id: 2, name: 'Classic Series', flavor: 'Mango', category: 103, quantity: 3, stock: 1, purchase_price: 100, price: 200, min_stock: 1, barcode: 'L001' }
    ],
    transactions: [],
    purchases: [],
    categories: [
      { _id: 103, name: 'Liquid' },
      { _id: 104, name: 'Devices' }
    ],
    filters: { start: '2026-05-01', end: '2026-05-30', category: '104', status: 'all', search: 'vaporesso' }
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].productName, 'XROS 5');
});
