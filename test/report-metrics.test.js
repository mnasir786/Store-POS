const test = require('node:test');
const assert = require('node:assert/strict');

const reportMetrics = require('../api/report-metrics');

test('discounted sale reduces category revenue, top-seller revenue, and profit', () => {
  const metrics = reportMetrics.buildDailySalesMetrics([
    {
      _id: 1,
      status: 1,
      payment_type: 'Cash',
      total: '2700.00',
      subtotal: '2700.00',
      discount: '100.00',
      tax: '0.00',
      items: [
        {
          id: 1001,
          product_name: 'CLASSIC SERIES',
          product_display_name: 'CLASSIC SERIES | TOKYO | WATER MELON ICED | 30 | 50',
          quantity: 1,
          price: 2800,
          category: '103'
        }
      ]
    }
  ], [
    {
      _id: 1001,
      name: 'CLASSIC SERIES',
      brand: 'TOKYO',
      flavor: 'WATER MELON ICED',
      size: '30',
      nicotine: '50',
      purchase_price: 1850
    }
  ]);

  assert.equal(metrics.totalSales, 2700);
  assert.equal(metrics.totalDiscount, 100);
  assert.equal(metrics.categorySales[0].total, 2700);
  assert.equal(metrics.topSellers[0].revenue, 2700);
  assert.equal(metrics.profitEstimate, 850);
});

test('refund reverses discounted revenue and discount totals safely', () => {
  const metrics = reportMetrics.buildDailySalesMetrics([
    {
      _id: 1,
      status: 1,
      payment_type: 'Cash',
      transaction_type: 'refund',
      total: '-2700.00',
      subtotal: '-2700.00',
      discount: '100.00',
      tax: '0.00',
      items: [
        {
          id: 1001,
          product_name: 'CLASSIC SERIES',
          product_display_name: 'CLASSIC SERIES | TOKYO | WATER MELON ICED | 30 | 50',
          quantity: 1,
          price: 2800,
          category: '103'
        }
      ]
    }
  ], [
    {
      _id: 1001,
      name: 'CLASSIC SERIES',
      purchase_price: 1850
    }
  ]);

  assert.equal(metrics.totalSales, -2700);
  assert.equal(metrics.totalDiscount, -100);
  assert.equal(metrics.categorySales[0].total, -2700);
  assert.equal(metrics.profitEstimate, -850);
});

test('product display name falls back to full product details when available', () => {
  const label = reportMetrics.buildProductDisplayName(
    { product_name: 'XROS', brand: 'Vaporesso', model: 'XROS 5', flavor: '', size: '', nicotine: '' },
    null
  );

  assert.equal(label, 'XROS | Vaporesso | XROS 5');
});
