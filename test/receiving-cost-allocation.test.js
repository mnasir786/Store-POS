const test = require('node:test');
const assert = require('node:assert/strict');

const receivingCostAllocation = require('../api/receiving-cost-allocation');

test('autoAllocateUnitCosts scales existing unit costs when every row stays within 5%', () => {
  const result = receivingCostAllocation.autoAllocateUnitCosts([
    { quantity: 1, currentUnitCost: 100 },
    { quantity: 1, currentUnitCost: 200 }
  ], 309);

  assert.equal(result.exactMatch, true);
  assert.equal(result.lineTotal, 309);
  assert.equal(result.unitCosts.length, 2);
  assert.ok(result.unitCosts.every(cost => cost >= 0));
  const recalculatedTotal = result.unitCosts.reduce((sum, cost) => sum + cost, 0);
  assert.equal(Number(recalculatedTotal.toFixed(2)), 309);
  assert.ok(Math.abs(result.unitCosts[0] - 100) <= 5);
  assert.ok(Math.abs(result.unitCosts[1] - 200) <= 10);
});

test('autoAllocateUnitCosts rejects rows without a baseline unit cost', () => {
  const result = receivingCostAllocation.autoAllocateUnitCosts([
    { quantity: 2, currentUnitCost: 0 },
    { quantity: 1, currentUnitCost: 0 }
  ], 150);

  assert.equal(result.exactMatch, false);
  assert.match(result.error, /requires a current unit cost/i);
});

test('autoAllocateUnitCosts warns when invoice total cannot be represented exactly', () => {
  const result = receivingCostAllocation.autoAllocateUnitCosts([
    { quantity: 2, currentUnitCost: 100 },
    { quantity: 2, currentUnitCost: 100 }
  ], 100.01);

  assert.equal(result.exactMatch, false);
  assert.match(result.error, /not possible/i);
});

test('autoAllocateUnitCosts rejects adjustments above the 5% per-item safety limit', () => {
  const result = receivingCostAllocation.autoAllocateUnitCosts([
    { quantity: 1, currentUnitCost: 100 },
    { quantity: 1, currentUnitCost: 200 }
  ], 330);

  assert.equal(result.exactMatch, false);
  assert.match(result.error, /limited to unit cost changes within 5%/i);
});
