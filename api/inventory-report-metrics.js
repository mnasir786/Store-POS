const reportMetrics = require('./report-metrics');

function normalizeStatusValue(status) {
  return String(status || 'all').toLowerCase();
}

function parseDateValue(value, fallback) {
  const parsed = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function isWithinRange(dateValue, startDate, endDate) {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed >= startDate && parsed <= endDate;
}

function toMoney(value) {
  return reportMetrics.centsToAmount(reportMetrics.toCents(value));
}

function buildCategoryMaps(categories = []) {
  const byId = {};
  categories.forEach(category => {
    byId[String(category._id)] = category;
  });
  return byId;
}

function buildMovementMaps(transactions, productsById, startDate, endDate) {
  const movementByProduct = {};
  const lastSoldByProduct = {};

  (transactions || []).forEach(transaction => {
    const status = Number.parseInt(transaction.status, 10);
    if (status !== 1) {
      return;
    }

    const lineMetrics = reportMetrics.buildTransactionLineMetrics(transaction, productsById);
    const txDate = transaction.date || transaction.created_at;
    const inWindow = isWithinRange(txDate, startDate, endDate);

    lineMetrics.forEach(line => {
      const productId = String(line.id);
      if (!productId) {
        return;
      }

      if (!movementByProduct[productId]) {
        movementByProduct[productId] = {
          unitsSold: 0,
          revenue: 0
        };
      }

      if (inWindow) {
        movementByProduct[productId].unitsSold += Number.parseInt(line.quantity_signed, 10) || 0;
        movementByProduct[productId].revenue += Number.parseFloat(line.net_line_revenue) || 0;
      }

      const existingDate = lastSoldByProduct[productId] ? new Date(lastSoldByProduct[productId]) : null;
      const currentDate = new Date(txDate);
      if (!Number.isNaN(currentDate.getTime()) && (!existingDate || currentDate > existingDate)) {
        lastSoldByProduct[productId] = currentDate.toISOString();
      }
    });
  });

  return { movementByProduct, lastSoldByProduct };
}

function buildLastReceivedMap(purchases = []) {
  const lastReceivedByProduct = {};

  (purchases || []).forEach(purchase => {
    const purchaseDate = new Date(purchase.created_at);
    if (Number.isNaN(purchaseDate.getTime())) {
      return;
    }

    (purchase.items || []).forEach(item => {
      const productId = String(item.productId);
      const existingDate = lastReceivedByProduct[productId] ? new Date(lastReceivedByProduct[productId]) : null;
      if (!existingDate || purchaseDate > existingDate) {
        lastReceivedByProduct[productId] = purchaseDate.toISOString();
      }
    });
  });

  return lastReceivedByProduct;
}

function getMovementStatus(product, quantity, soldUnitsWindow) {
  if (quantity <= 0) {
    return 'none';
  }

  if (soldUnitsWindow === 0) {
    return 'dead_stock';
  }

  const threshold = Number.parseInt(product.min_stock, 10) > 0
    ? Number.parseInt(product.min_stock, 10)
    : 1;

  if (soldUnitsWindow <= threshold) {
    return 'slow_moving';
  }

  return 'fast_moving';
}

function getStockStatus(product, quantity) {
  const stockTracked = Number.parseInt(product.stock, 10) === 1;
  if (!stockTracked) {
    return 'non_tracked';
  }

  if (quantity <= 0) {
    return 'out_of_stock';
  }

  if ((Number.parseInt(product.min_stock, 10) || 0) > 0 && quantity <= Number.parseInt(product.min_stock, 10)) {
    return 'low_stock';
  }

  return 'in_stock';
}

function matchesSearch(row, searchTerm) {
  if (!searchTerm) {
    return true;
  }

  return String(row.searchText || '').includes(searchTerm);
}

function matchesStatus(row, statusFilter) {
  if (statusFilter === 'all') {
    return true;
  }

  if (statusFilter === 'in_stock' || statusFilter === 'low_stock' || statusFilter === 'out_of_stock' || statusFilter === 'non_tracked') {
    return row.stockStatus === statusFilter;
  }

  if (statusFilter === 'dead_stock' || statusFilter === 'slow_moving' || statusFilter === 'fast_moving') {
    return row.movementStatus === statusFilter;
  }

  return true;
}

function buildCharts(rows) {
  const categoryMap = {};
  const stockStatusCounts = {
    in_stock: 0,
    low_stock: 0,
    out_of_stock: 0,
    non_tracked: 0
  };
  const movementCounts = {
    fast_moving: 0,
    slow_moving: 0,
    dead_stock: 0,
    none: 0
  };

  rows.forEach(row => {
    categoryMap[row.categoryName] = (categoryMap[row.categoryName] || 0) + row.costValue;
    stockStatusCounts[row.stockStatus] = (stockStatusCounts[row.stockStatus] || 0) + 1;
    movementCounts[row.movementStatus] = (movementCounts[row.movementStatus] || 0) + 1;
  });

  const byCost = rows
    .slice()
    .sort((left, right) => right.costValue - left.costValue)
    .slice(0, 10);

  const byRetail = rows
    .slice()
    .sort((left, right) => right.retailValue - left.retailValue)
    .slice(0, 10);

  return {
    valueByCategory: {
      labels: Object.keys(categoryMap),
      data: Object.values(categoryMap).map(toMoney)
    },
    topCostItems: {
      labels: byCost.map(row => row.productDisplayName),
      data: byCost.map(row => toMoney(row.costValue))
    },
    topRetailItems: {
      labels: byRetail.map(row => row.productDisplayName),
      data: byRetail.map(row => toMoney(row.retailValue))
    },
    stockStatus: {
      labels: ['In Stock', 'Low Stock', 'Out of Stock', 'Non-tracked'],
      data: [
        stockStatusCounts.in_stock || 0,
        stockStatusCounts.low_stock || 0,
        stockStatusCounts.out_of_stock || 0,
        stockStatusCounts.non_tracked || 0
      ]
    },
    movementStatus: {
      labels: ['Fast Moving', 'Slow Moving', 'Dead Stock', 'No Recent Activity'],
      data: [
        movementCounts.fast_moving || 0,
        movementCounts.slow_moving || 0,
        movementCounts.dead_stock || 0,
        movementCounts.none || 0
      ]
    }
  };
}

function buildSummary(rows) {
  const trackedRows = rows.filter(row => row.stockTracked);
  const totalSkus = trackedRows.length;
  const totalUnits = trackedRows.reduce((sum, row) => sum + row.quantity, 0);
  const inventoryCostValue = trackedRows.reduce((sum, row) => sum + row.costValue, 0);
  const inventoryRetailValue = trackedRows.reduce((sum, row) => sum + row.retailValue, 0);
  const potentialGrossProfit = trackedRows.reduce((sum, row) => sum + row.potentialGrossProfit, 0);
  const potentialMarginPercent = inventoryRetailValue > 0
    ? ((potentialGrossProfit / inventoryRetailValue) * 100)
    : 0;

  return {
    totalSkus,
    totalUnits,
    inventoryCostValue: toMoney(inventoryCostValue),
    inventoryRetailValue: toMoney(inventoryRetailValue),
    potentialGrossProfit: toMoney(potentialGrossProfit),
    potentialMarginPercent: Math.round(potentialMarginPercent * 100) / 100,
    lowStockCount: trackedRows.filter(row => row.stockStatus === 'low_stock').length,
    outOfStockCount: trackedRows.filter(row => row.stockStatus === 'out_of_stock').length,
    deadStockCount: trackedRows.filter(row => row.movementStatus === 'dead_stock').length,
    slowMovingCount: trackedRows.filter(row => row.movementStatus === 'slow_moving').length
  };
}

function computeInventoryReport({
  products = [],
  transactions = [],
  purchases = [],
  categories = [],
  filters = {}
}) {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 29);

  const startDate = startOfDay(parseDateValue(filters.start, defaultStart));
  const endDate = endOfDay(parseDateValue(filters.end, now));
  const categoryFilter = String(filters.category || '0');
  const statusFilter = normalizeStatusValue(filters.status);
  const searchTerm = String(filters.search || '').trim().toLowerCase();

  const productsById = {};
  (products || []).forEach(product => {
    productsById[String(product._id)] = product;
  });

  const categoriesById = buildCategoryMaps(categories);
  const { movementByProduct, lastSoldByProduct } = buildMovementMaps(transactions, productsById, startDate, endDate);
  const lastReceivedByProduct = buildLastReceivedMap(purchases);

  const rows = (products || []).map(product => {
    const productId = String(product._id);
    const categoryRecord = categoriesById[String(product.category)] || {};
    const quantity = Number.parseInt(product.quantity, 10) || 0;
    const purchasePrice = Number.parseFloat(product.purchase_price) || 0;
    const salePrice = Number.parseFloat(product.price) || 0;
    const stockTracked = Number.parseInt(product.stock, 10) === 1;
    const movement = movementByProduct[productId] || { unitsSold: 0, revenue: 0 };
    const productDisplayName = reportMetrics.buildProductDisplayName(product);
    const costValue = stockTracked ? quantity * purchasePrice : 0;
    const retailValue = stockTracked ? quantity * salePrice : 0;
    const potentialGrossProfit = retailValue - costValue;
    const marginPercent = retailValue > 0 ? ((potentialGrossProfit / retailValue) * 100) : 0;
    const stockStatus = getStockStatus(product, quantity);
    const movementStatus = stockTracked
      ? getMovementStatus(product, quantity, movement.unitsSold)
      : 'none';

    return {
      id: product._id,
      productName: product.name,
      productDisplayName,
      category: product.category,
      categoryName: categoryRecord.name || `Category #${product.category}`,
      barcode: product.barcode || '',
      quantity,
      minStock: Number.parseInt(product.min_stock, 10) || 0,
      stockTracked,
      stockStatus,
      movementStatus,
      purchasePrice: toMoney(purchasePrice),
      salePrice: toMoney(salePrice),
      costValue: toMoney(costValue),
      retailValue: toMoney(retailValue),
      potentialGrossProfit: toMoney(potentialGrossProfit),
      marginPercent: Math.round(marginPercent * 100) / 100,
      unitsSoldWindow: movement.unitsSold,
      revenueWindow: toMoney(movement.revenue),
      lastSoldDate: lastSoldByProduct[productId] || null,
      lastReceivedDate: lastReceivedByProduct[productId] || null,
      searchText: [
        productDisplayName,
        product.name || '',
        product.brand || '',
        product.model || '',
        product.flavor || '',
        product.size || '',
        product.nicotine || '',
        product.barcode || '',
        categoryRecord.name || ''
      ].join(' ').toLowerCase()
    };
  }).filter(row => {
    if (categoryFilter !== '0' && String(row.category) !== categoryFilter) {
      return false;
    }

    if (!matchesStatus(row, statusFilter)) {
      return false;
    }

    return matchesSearch(row, searchTerm);
  });

  return {
    summary: buildSummary(rows),
    charts: buildCharts(rows),
    rows,
    filters: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      category: categoryFilter,
      status: statusFilter,
      search: searchTerm
    }
  };
}

module.exports = {
  computeInventoryReport
};
