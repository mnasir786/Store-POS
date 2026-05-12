const test = require('node:test');
const assert = require('node:assert/strict');

const salesReportMetrics = require('../api/sales-report-metrics');

function buildFixture(overrides = {}) {
  return salesReportMetrics.computeSalesReport({
    transactions: overrides.transactions || [],
    products: overrides.products || [],
    categories: overrides.categories || [],
    users: overrides.users || [],
    customers: overrides.customers || [],
    expenses: overrides.expenses || [],
    filters: Object.assign({
      start: '2026-05-01',
      end: '2026-05-31',
      till: 'all',
      cashier: 'all',
      payment: 'all',
      customer: 'all',
      category: '0',
      mode: 'net',
      search: ''
    }, overrides.filters || {})
  });
}

test('sales report calculates gross sales, refunds, net sales, discounts, and profit', () => {
  const report = buildFixture({
    transactions: [
      {
        _id: 1,
        order: 'INV-1',
        status: 1,
        payment_type: 'Cash',
        total: '2700.00',
        discount: '100.00',
        date: '2026-05-12T09:00:00.000Z',
        user: 'Administrator',
        user_id: 1,
        customer: { _id: 'c1', name: 'Nasir' },
        items: [
          {
            id: 1001,
            product_name: 'CLASSIC SERIES',
            product_display_name: 'CLASSIC SERIES | TOKYO | MANGO LYCHEE | 30 | 50',
            quantity: 1,
            price: 2800,
            category: '103'
          }
        ]
      },
      {
        _id: 2,
        order: 'INV-2',
        status: 1,
        transaction_type: 'refund',
        payment_type: 'Cash',
        total: '-2700.00',
        discount: '100.00',
        date: '2026-05-13T09:00:00.000Z',
        user: 'Administrator',
        user_id: 1,
        customer: { _id: 'c1', name: 'Nasir' },
        items: [
          {
            id: 1001,
            product_name: 'CLASSIC SERIES',
            product_display_name: 'CLASSIC SERIES | TOKYO | MANGO LYCHEE | 30 | 50',
            quantity: 1,
            price: 2800,
            category: '103'
          }
        ]
      }
    ],
    products: [
      { _id: 1001, name: 'CLASSIC SERIES', purchase_price: 1850, category: '103' }
    ],
    categories: [{ _id: '103', name: 'Liquid' }],
    users: [{ _id: 1, fullname: 'Administrator' }],
    customers: [{ _id: 'c1', name: 'Nasir' }]
  });

  assert.equal(report.summary.grossSales, 2700);
  assert.equal(report.summary.refunds, 2700);
  assert.equal(report.summary.netSales, 0);
  assert.equal(report.summary.discountsGiven, 0);
  assert.equal(report.summary.grossProfit, 0);
  assert.equal(report.tables.topProducts[0].revenue, 0);
});

test('sales report applies till, cashier, payment, customer, category, and search filters', () => {
  const report = buildFixture({
    transactions: [
      {
        _id: 1,
        order: 'INV-XROS',
        status: 1,
        payment_type: 'Card',
        total: '900.00',
        discount: '0.00',
        date: '2026-05-12T09:00:00.000Z',
        till: 2,
        user: 'Administrator',
        user_id: 1,
        customer: { _id: 'c2', name: 'Ali' },
        items: [
          {
            id: 2001,
            product_name: 'XROS 0.8',
            product_display_name: 'XROS 0.8 | VAPORESSO',
            quantity: 1,
            price: 900,
            category: '104',
            brand: 'VAPORESSO'
          }
        ]
      },
      {
        _id: 2,
        order: 'INV-LIQ',
        status: 1,
        payment_type: 'Cash',
        total: '2800.00',
        discount: '0.00',
        date: '2026-05-12T10:00:00.000Z',
        till: 1,
        user: 'Cashier Two',
        user_id: 2,
        customer: { _id: 'c3', name: 'Sara' },
        items: [
          {
            id: 3001,
            product_name: 'CLASSIC SERIES',
            product_display_name: 'CLASSIC SERIES | TOKYO | WATER MELON ICED | 30 | 50',
            quantity: 1,
            price: 2800,
            category: '103'
          }
        ]
      }
    ],
    products: [
      { _id: 2001, name: 'XROS 0.8', purchase_price: 700, category: '104' },
      { _id: 3001, name: 'CLASSIC SERIES', purchase_price: 1800, category: '103' }
    ],
    categories: [{ _id: '103', name: 'Liquid' }, { _id: '104', name: 'Coils' }],
    users: [{ _id: 1, fullname: 'Administrator' }, { _id: 2, fullname: 'Cashier Two' }],
    customers: [{ _id: 'c2', name: 'Ali' }, { _id: 'c3', name: 'Sara' }],
    filters: {
      till: '2',
      cashier: '1',
      payment: 'card',
      customer: 'c2',
      category: '104',
      search: 'xros'
    }
  });

  assert.equal(report.summary.netSales, 900);
  assert.equal(report.summary.cardSales, 900);
  assert.equal(report.tables.transactions.length, 1);
  assert.equal(report.tables.transactions[0].invoice, 'INV-XROS');
});

test('sales report calculates expenses inside range for net profit and daily buckets', () => {
  const report = buildFixture({
    transactions: [
      {
        _id: 1,
        order: 'INV-1',
        status: 1,
        payment_type: 'Cash',
        total: '2800.00',
        discount: '0.00',
        date: '2026-05-12T09:00:00.000Z',
        user: 'Administrator',
        user_id: 1,
        customer: 0,
        items: [
          {
            id: 3001,
            product_name: 'CLASSIC SERIES',
            product_display_name: 'CLASSIC SERIES | TOKYO | WATER MELON ICED | 30 | 50',
            quantity: 1,
            price: 2800,
            category: '103'
          }
        ]
      }
    ],
    products: [
      { _id: 3001, name: 'CLASSIC SERIES', purchase_price: 1800, category: '103' }
    ],
    categories: [{ _id: '103', name: 'Liquid' }],
    users: [{ _id: 1, fullname: 'Administrator' }],
    expenses: [
      { _id: 'e1', amount: 200, date: '2026-05-12T12:00:00.000Z' },
      { _id: 'e2', amount: 150, date: '2026-04-30T12:00:00.000Z' }
    ]
  });

  assert.equal(report.summary.grossProfit, 1000);
  assert.equal(report.summary.totalExpenses, 200);
  assert.equal(report.summary.netProfit, 800);
  assert.equal(report.tables.dailyBreakdown[0].netProfit, 800);
});

test('sales report supports refunds-only mode and top rankings', () => {
  const report = buildFixture({
    transactions: [
      {
        _id: 1,
        order: 'REF-1',
        status: 1,
        transaction_type: 'refund',
        payment_type: 'Cash',
        total: '-900.00',
        discount: '0.00',
        date: '2026-05-14T09:00:00.000Z',
        user: 'Administrator',
        user_id: 1,
        customer: { _id: 'c2', name: 'Ali' },
        items: [
          {
            id: 2001,
            product_name: 'XROS 0.8',
            product_display_name: 'XROS 0.8 | VAPORESSO',
            quantity: 1,
            price: 900,
            category: '104'
          }
        ]
      }
    ],
    products: [{ _id: 2001, name: 'XROS 0.8', purchase_price: 700, category: '104' }],
    categories: [{ _id: '104', name: 'Coils' }],
    users: [{ _id: 1, fullname: 'Administrator' }],
    customers: [{ _id: 'c2', name: 'Ali' }],
    filters: { mode: 'refunds_only' }
  });

  assert.equal(report.summary.grossSales, 0);
  assert.equal(report.summary.refunds, 900);
  assert.equal(report.summary.netSales, -900);
  assert.equal(report.tables.topCashiers[0].name, 'Administrator');
  assert.equal(report.tables.topCustomers[0].name, 'Ali');
});

test('sales report allocates discount proportionally across categories and products', () => {
  const report = buildFixture({
    transactions: [
      {
        _id: 1,
        order: 'INV-MIX',
        status: 1,
        payment_type: 'Cash',
        total: '3600.00',
        discount: '100.00',
        date: '2026-05-12T09:00:00.000Z',
        user: 'Administrator',
        user_id: 1,
        customer: { _id: 'c1', name: 'Nasir' },
        items: [
          {
            id: 3001,
            product_name: 'CLASSIC SERIES',
            product_display_name: 'CLASSIC SERIES | TOKYO | MANGO LYCHEE | 30 | 50',
            quantity: 1,
            price: 2800,
            category: '103'
          },
          {
            id: 2001,
            product_name: 'XROS 0.8',
            product_display_name: 'XROS 0.8 | VAPORESSO',
            quantity: 1,
            price: 900,
            category: '104'
          }
        ]
      }
    ],
    products: [
      { _id: 3001, name: 'CLASSIC SERIES', purchase_price: 1850, category: '103' },
      { _id: 2001, name: 'XROS 0.8', purchase_price: 700, category: '104' }
    ],
    categories: [{ _id: '103', name: 'Liquid' }, { _id: '104', name: 'Coils' }],
    users: [{ _id: 1, fullname: 'Administrator' }],
    customers: [{ _id: 'c1', name: 'Nasir' }]
  });

  assert.equal(report.summary.netSales, 3600);
  assert.equal(report.summary.discountsGiven, 100);
  assert.equal(report.tables.topProducts[0].name, 'CLASSIC SERIES | TOKYO | MANGO LYCHEE | 30 | 50');
  assert.equal(report.tables.topProducts[0].revenue, 2724.32);
  assert.equal(report.tables.topCategories[1].revenue, 875.68);
});
