function toCents(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function gcdArray(values) {
  return values.reduce((current, value) => gcd(current, value), 0) || 1;
}

function findWeightedAdjustment(weights, target, capacities) {
  const memo = new Map();

  function dfs(index, remaining) {
    if (remaining === 0) {
      return new Array(weights.length - index).fill(0);
    }

    if (index >= weights.length || remaining < 0) {
      return null;
    }

    const key = `${index}:${remaining}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    const weight = weights[index];
    const maxCount = capacities
      ? Math.min(capacities[index], Math.floor(remaining / weight))
      : Math.floor(remaining / weight);

    for (let count = maxCount; count >= 0; count -= 1) {
      const remainder = remaining - (count * weight);
      const rest = dfs(index + 1, remainder);
      if (rest) {
        const result = [count].concat(rest);
        memo.set(key, result);
        return result;
      }
    }

    memo.set(key, null);
    return null;
  }

  return dfs(0, target);
}

function autoAllocateUnitCosts(items, invoiceTotal, maxPercentChange = 0.05) {
  const normalizedItems = (items || [])
    .map(item => ({
      quantity: Number.parseInt(item.quantity, 10) || 0,
      currentUnitCostCents: toCents(item.currentUnitCost)
    }))
    .filter(item => item.quantity > 0);

  if (normalizedItems.length === 0) {
    return {
      exactMatch: false,
      error: 'Add at least one product row with a positive quantity before auto-adjusting costs.'
    };
  }

  const invoiceTotalCents = toCents(invoiceTotal);
  if (invoiceTotalCents <= 0) {
    return {
      exactMatch: false,
      error: 'Enter a supplier invoice total before auto-adjusting unit costs.'
    };
  }

  if (normalizedItems.some(item => item.currentUnitCostCents <= 0)) {
    return {
      exactMatch: false,
      error: 'Auto-adjust requires a current unit cost for every selected row. Fill or confirm each unit cost first.'
    };
  }

  const quantities = normalizedItems.map(item => item.quantity);
  const quantityGcd = gcdArray(quantities);
  if (invoiceTotalCents % quantityGcd !== 0) {
    return {
      exactMatch: false,
      error: 'Exact allocation is not possible with the current quantities and 2-decimal unit prices. Re-check the quantity of each line item, then adjust the invoice total or unit costs manually if needed.'
    };
  }

  const totalQuantity = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const currentTotalCents = normalizedItems.reduce(
    (sum, item) => sum + (item.quantity * item.currentUnitCostCents),
    0
  );

  let unitCostCents;
  const factor = invoiceTotalCents / currentTotalCents;
  unitCostCents = normalizedItems.map(item => Math.max(0, Math.round(item.currentUnitCostCents * factor)));

  const assignedTotalCents = () => normalizedItems.reduce(
    (sum, item, index) => sum + (item.quantity * unitCostCents[index]),
    0
  );

  let diffCents = invoiceTotalCents - assignedTotalCents();
  if (diffCents !== 0) {
    const adjustmentCounts = diffCents > 0
      ? findWeightedAdjustment(quantities, diffCents)
      : findWeightedAdjustment(quantities, Math.abs(diffCents), unitCostCents);

    if (!adjustmentCounts) {
      return {
        exactMatch: false,
        error: 'Could not auto-adjust unit costs to an exact total. Re-check the quantity of each line item, then tweak one or more unit costs manually.'
      };
    }

    unitCostCents = unitCostCents.map((cost, index) => {
      const delta = adjustmentCounts[index] || 0;
      return diffCents > 0 ? cost + delta : cost - delta;
    });

    diffCents = invoiceTotalCents - assignedTotalCents();
  }

  const exceedsAllowedChange = unitCostCents.some((cost, index) => {
    const currentCost = normalizedItems[index].currentUnitCostCents;
    const maximumAllowedChange = Math.round(currentCost * maxPercentChange);
    return Math.abs(cost - currentCost) > maximumAllowedChange;
  });

  if (exceedsAllowedChange) {
    return {
      exactMatch: false,
      error: `Auto-adjust is limited to unit cost changes within ${Math.round(maxPercentChange * 100)}% per item. Re-check the quantity of each line item, then review the invoice total or line costs manually.`
    };
  }

  return {
    exactMatch: diffCents === 0,
    unitCosts: unitCostCents.map(fromCents),
    lineTotal: fromCents(assignedTotalCents()),
    invoiceTotal: fromCents(invoiceTotalCents)
  };
}

module.exports = {
  autoAllocateUnitCosts,
  toCents,
  fromCents
};
