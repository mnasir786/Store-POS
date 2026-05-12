function toCents(value) {
  return Math.round((Number.parseFloat(value) || 0) * 100);
}

function centsToAmount(value) {
  return Math.round(value) / 100;
}

function normalizeTransactionType(transactionType) {
  return transactionType === 'refund' ? 'refund' : 'sale';
}

function buildProductDisplayName(item, product) {
  if (item && item.product_display_name) {
    return item.product_display_name;
  }

  const source = product || item || {};
  const parts = [];
  const baseName = String(source.product_name || source.name || 'Unknown').trim();
  const normalizedBaseName = baseName.toLowerCase();
  const normalizedModel = String(source.model || '').trim().toLowerCase();

  if (source.brand) parts.push(String(source.brand).trim());
  if (source.model && normalizedModel !== normalizedBaseName) parts.push(String(source.model).trim());
  if (source.flavor) parts.push(String(source.flavor).trim());
  if (source.size) parts.push(String(source.size).trim());
  if (source.nicotine) parts.push(String(source.nicotine).trim());

  return parts.length > 0 ? `${baseName} | ${parts.join(' | ')}` : baseName;
}

function allocateDiscountShares(items, totalDiscountCents) {
  const grossLineCents = items.map(item => (Number.parseInt(item.quantity, 10) || 0) * toCents(item.price));
  const grossSubtotalCents = grossLineCents.reduce((sum, value) => sum + value, 0);

  if (grossSubtotalCents <= 0 || totalDiscountCents <= 0) {
    return items.map(() => 0);
  }

  const provisional = grossLineCents.map((lineCents, index) => {
    const numerator = totalDiscountCents * lineCents;
    return {
      index,
      share: Math.floor(numerator / grossSubtotalCents),
      remainder: numerator % grossSubtotalCents
    };
  });

  let allocated = provisional.reduce((sum, entry) => sum + entry.share, 0);
  let remaining = totalDiscountCents - allocated;

  provisional.sort((left, right) => right.remainder - left.remainder);
  for (let i = 0; i < provisional.length && remaining > 0; i += 1, remaining -= 1) {
    provisional[i].share += 1;
  }

  const result = items.map(() => 0);
  provisional.forEach(entry => {
    result[entry.index] = entry.share;
  });

  return result;
}

function buildDailySalesMetrics(transactions, products = []) {
  const productMap = {};
  (products || []).forEach(product => {
    productMap[product._id] = product;
  });

  let totalSalesCents = 0;
  let cashTotalCents = 0;
  let cardTotalCents = 0;
  let onAccountTotalCents = 0;
  let refillTotalCents = 0;
  let totalDiscountCents = 0;
  let totalMlDispensed = 0;

  const categorySales = {};
  const productSales = {};

  (transactions || []).forEach(transaction => {
    const sign = normalizeTransactionType(transaction.transaction_type) === 'refund' ? -1 : 1;
    totalSalesCents += toCents(transaction.total);
    totalDiscountCents += sign * toCents(transaction.discount);

    const paymentType = String(transaction.payment_type || '').toLowerCase();
    if (paymentType === 'cash') cashTotalCents += toCents(transaction.total);
    else if (paymentType === 'card') cardTotalCents += toCents(transaction.total);
    else if (paymentType === 'on account') onAccountTotalCents += toCents(transaction.total);

    const items = Array.isArray(transaction.items) ? transaction.items : [];
    const discountShares = allocateDiscountShares(items, toCents(transaction.discount));

    items.forEach((item, index) => {
      const quantity = Number.parseInt(item.quantity, 10) || 0;
      const qtySigned = quantity * sign;
      const grossLineCents = quantity * toCents(item.price) * sign;
      const discountShareCents = discountShares[index] || 0;
      const netLineRevenueCents = grossLineCents - (sign * discountShareCents);

      const categoryId = item.category || 'unknown';
      const product = productMap[item.id] || {};
      const displayName = buildProductDisplayName(item, product);
      const productKey = item.id || `${displayName}::${index}`;

      if (!categorySales[categoryId]) {
        categorySales[categoryId] = { category: categoryId, totalCents: 0, qty: 0 };
      }
      categorySales[categoryId].totalCents += netLineRevenueCents;
      categorySales[categoryId].qty += qtySigned;

      if ((String(item.product_name || '').toLowerCase() === 'refill') || categoryId == '102') {
        refillTotalCents += netLineRevenueCents;
        totalMlDispensed += (Number.parseInt(item.ml, 10) || 0) * quantity;
      }

      if (!productSales[productKey]) {
        productSales[productKey] = {
          id: item.id,
          name: displayName,
          qty: 0,
          revenueCents: 0,
          totalCostCents: 0,
          costPerUnit: Number.parseFloat(product.purchase_price) || 0
        };
      }

      productSales[productKey].qty += qtySigned;
      productSales[productKey].revenueCents += netLineRevenueCents;

      const mlDispensed = Number.parseInt(item.ml, 10) || 0;
      if (mlDispensed > 0) {
        productSales[productKey].totalCostCents += sign * quantity * mlDispensed * toCents(product.purchase_price);
      } else {
        productSales[productKey].totalCostCents += sign * quantity * toCents(product.purchase_price);
      }
    });
  });

  const topSellers = Object.values(productSales)
    .sort((left, right) => right.qty - left.qty)
    .slice(0, 10)
    .map(item => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      revenue: centsToAmount(item.revenueCents),
      totalCost: centsToAmount(item.totalCostCents),
      costPerUnit: item.costPerUnit
    }));

  const profitEstimateCents = Object.values(productSales).reduce((sum, item) => {
    return sum + (item.revenueCents - item.totalCostCents);
  }, 0);

  return {
    totalSales: centsToAmount(totalSalesCents),
    totalTransactions: (transactions || []).length,
    cashTotal: centsToAmount(cashTotalCents),
    cardTotal: centsToAmount(cardTotalCents),
    onAccountTotal: centsToAmount(onAccountTotalCents),
    refillTotal: centsToAmount(refillTotalCents),
    totalDiscount: centsToAmount(totalDiscountCents),
    profitEstimate: centsToAmount(profitEstimateCents),
    categorySales: Object.values(categorySales).map(item => ({
      category: item.category,
      total: centsToAmount(item.totalCents),
      qty: item.qty
    })),
    topSellers,
    totalMlDispensed
  };
}

function buildTransactionLineMetrics(transaction, productsById = {}) {
  const sign = normalizeTransactionType(transaction.transaction_type) === 'refund' ? -1 : 1;
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  const discountShares = allocateDiscountShares(items, toCents(transaction.discount));

  return items.map((item, index) => {
    const product = productsById[String(item.id)] || productsById[item.id] || {};
    const quantity = Number.parseInt(item.quantity, 10) || 0;
    const grossLineCents = quantity * toCents(item.price) * sign;
    const discountShareCents = discountShares[index] || 0;

    return {
      ...item,
      product_display_name: item.product_display_name || buildProductDisplayName(item, product),
      quantity_signed: quantity * sign,
      net_line_revenue: centsToAmount(grossLineCents - (sign * discountShareCents))
    };
  });
}

module.exports = {
  allocateDiscountShares,
  buildDailySalesMetrics,
  buildProductDisplayName,
  buildTransactionLineMetrics,
  centsToAmount,
  toCents
};
