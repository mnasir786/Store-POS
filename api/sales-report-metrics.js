const reportMetrics = require('./report-metrics');

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

function normalizeMode(mode) {
  const normalized = String(mode || 'net').toLowerCase();
  return ['net', 'sales_only', 'refunds_only'].includes(normalized) ? normalized : 'net';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toMoney(cents) {
  return reportMetrics.centsToAmount(cents);
}

function formatDayKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMapById(items = []) {
  const map = {};
  (items || []).forEach(item => {
    map[String(item._id)] = item;
  });
  return map;
}

function resolveCustomer(transaction, customersById = {}) {
  if (!transaction.customer || transaction.customer === 0 || transaction.customer === '0') {
    return { id: '0', name: 'Walk in Customer' };
  }

  const customerId = transaction.customer._id || transaction.customer.id || transaction.customer.customerId || '';
  const lookup = customersById[String(customerId)] || {};
  return {
    id: customerId ? String(customerId) : '0',
    name: transaction.customer.name || lookup.name || `Customer ${customerId}`
  };
}

function resolveCashier(transaction, usersById = {}) {
  const userId = transaction.user_id != null ? String(transaction.user_id) : '';
  const lookup = usersById[userId] || {};
  return {
    id: userId || '0',
    name: transaction.user || lookup.fullname || (userId ? `User ${userId}` : 'Unknown User')
  };
}

function resolveCategoryName(categoryId, categoriesById = {}) {
  if (categoryId === undefined || categoryId === null || categoryId === '') {
    return 'Unknown Category';
  }

  const record = categoriesById[String(categoryId)];
  return record ? record.name : `Category #${categoryId}`;
}

function modeMatches(transactionType, mode) {
  if (mode === 'sales_only') {
    return transactionType !== 'refund';
  }

  if (mode === 'refunds_only') {
    return transactionType === 'refund';
  }

  return true;
}

function calculateLineCostCents(line, product) {
  const quantity = Number.parseInt(line.quantity, 10) || 0;
  const sign = line.quantity_signed < 0 ? -1 : 1;
  const purchasePriceCents = reportMetrics.toCents(product && product.purchase_price);
  const ml = Number.parseInt(line.ml, 10) || 0;

  if (ml > 0) {
    return sign * quantity * ml * purchasePriceCents;
  }

  return sign * quantity * purchasePriceCents;
}

function matchesSearch(searchTerm, transactionSummary) {
  if (!searchTerm) {
    return true;
  }

  return transactionSummary.searchText.includes(searchTerm);
}

function buildExpenseBuckets(expenses = [], startDate, endDate) {
  const byDay = {};
  let totalExpensesCents = 0;

  (expenses || []).forEach(expense => {
    if (!isWithinRange(expense.date || expense.created_at, startDate, endDate)) {
      return;
    }

    const amountCents = reportMetrics.toCents(expense.amount);
    const dayKey = formatDayKey(expense.date || expense.created_at);
    byDay[dayKey] = (byDay[dayKey] || 0) + amountCents;
    totalExpensesCents += amountCents;
  });

  return { byDay, totalExpensesCents };
}

function sortByRevenueDescending(rows) {
  return rows.slice().sort((left, right) => {
    if (right.revenueCents !== left.revenueCents) {
      return right.revenueCents - left.revenueCents;
    }
    return right.qty - left.qty;
  });
}

function computeSalesReport({
  transactions = [],
  products = [],
  categories = [],
  users = [],
  customers = [],
  expenses = [],
  filters = {}
}) {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 29);

  const startDate = startOfDay(parseDateValue(filters.start, defaultStart));
  const endDate = endOfDay(parseDateValue(filters.end, now));
  const tillFilter = String(filters.till || 'all');
  const cashierFilter = String(filters.cashier || 'all');
  const paymentFilter = normalizeText(filters.payment || 'all');
  const customerFilter = String(filters.customer || 'all');
  const categoryFilter = String(filters.category || '0');
  const mode = normalizeMode(filters.mode);
  const searchTerm = normalizeText(filters.search || '');

  const productsById = buildMapById(products);
  const categoriesById = buildMapById(categories);
  const usersById = buildMapById(users);
  const customersById = buildMapById(customers);
  const expenseBuckets = buildExpenseBuckets(expenses, startDate, endDate);

  const dailyBuckets = {};
  const paymentBuckets = {};
  const productBuckets = {};
  const categoryBuckets = {};
  const cashierBuckets = {};
  const customerBuckets = {};
  const transactionRows = [];

  let grossSalesCents = 0;
  let refundsCents = 0;
  let netSalesCents = 0;
  let discountsCents = 0;
  let itemsSold = 0;
  let transactionsCount = 0;
  let grossProfitCents = 0;

  (transactions || []).forEach(transaction => {
    if (Number.parseInt(transaction.status, 10) !== 1) {
      return;
    }

    if (!isWithinRange(transaction.date || transaction.created_at, startDate, endDate)) {
      return;
    }

    const transactionType = transaction.transaction_type === 'refund' ? 'refund' : 'sale';
    if (!modeMatches(transactionType, mode)) {
      return;
    }

    const tillValue = transaction.till == null ? 'null' : String(transaction.till);
    if (tillFilter !== 'all' && tillValue !== tillFilter) {
      return;
    }

    const cashierId = transaction.user_id == null ? '0' : String(transaction.user_id);
    if (cashierFilter !== 'all' && cashierId !== cashierFilter) {
      return;
    }

    const paymentType = String(transaction.payment_type || '');
    if (paymentFilter !== 'all' && paymentType.toLowerCase() !== paymentFilter) {
      return;
    }

    const customer = resolveCustomer(transaction, customersById);
    if (customerFilter !== 'all' && customer.id !== String(customerFilter)) {
      return;
    }

    const cashier = resolveCashier(transaction, usersById);
    const lineMetrics = reportMetrics.buildTransactionLineMetrics(transaction, productsById);
    const filteredLines = lineMetrics.filter(line => {
      if (categoryFilter !== '0' && String(line.category) !== categoryFilter) {
        return false;
      }
      return true;
    });

    if (filteredLines.length === 0) {
      return;
    }

    const transactionSearchText = [
      transaction.order,
      transaction.ref_number,
      customer.name,
      cashier.name,
      transaction.payment_type,
      ...filteredLines.map(line => line.product_display_name || line.product_name || ''),
      ...filteredLines.map(line => line.sku || ''),
      ...filteredLines.map(line => line.brand || ''),
      ...filteredLines.map(line => line.model || ''),
      ...filteredLines.map(line => line.flavor || '')
    ].join(' ').toLowerCase();

    if (!matchesSearch(searchTerm, { searchText: transactionSearchText })) {
      return;
    }

    const dayKey = formatDayKey(transaction.date || transaction.created_at);
    if (!dailyBuckets[dayKey]) {
      dailyBuckets[dayKey] = {
        date: dayKey,
        grossSalesCents: 0,
        refundsCents: 0,
        netSalesCents: 0,
        discountsCents: 0,
        itemsSold: 0,
        transactionsCount: 0,
        grossProfitCents: 0
      };
    }

    let transactionGrossSalesCents = 0;
    let transactionRefundsCents = 0;
    let transactionNetSalesCents = 0;
    let transactionDiscountsCents = 0;
    let transactionItemsSold = 0;
    let transactionGrossProfitCents = 0;

    filteredLines.forEach(line => {
      const product = productsById[String(line.id)] || {};
      const categoryName = resolveCategoryName(line.category, categoriesById);
      const quantitySigned = Number.parseInt(line.quantity_signed, 10) || 0;
      const grossRevenueCents = Number.parseInt(line.gross_line_revenue_cents, 10) || 0;
      const netRevenueCents = Number.parseInt(line.net_line_revenue_cents, 10) || 0;
      const discountShareCents = Number.parseInt(line.discount_share_cents, 10) || 0;
      const lineCostCents = calculateLineCostCents(line, product);
      const lineGrossProfitCents = netRevenueCents - lineCostCents;
      const productLabel = line.product_display_name || reportMetrics.buildProductDisplayName(line, product);
      const productKey = String(line.id || productLabel);

      if (transactionType === 'refund') {
        transactionRefundsCents += Math.abs(netRevenueCents);
      } else {
        transactionGrossSalesCents += netRevenueCents;
      }

      transactionNetSalesCents += netRevenueCents;
      transactionDiscountsCents += discountShareCents;
      transactionItemsSold += quantitySigned;
      transactionGrossProfitCents += lineGrossProfitCents;

      if (!productBuckets[productKey]) {
        productBuckets[productKey] = {
          id: line.id,
          name: productLabel,
          qty: 0,
          revenueCents: 0,
          grossProfitCents: 0
        };
      }
      productBuckets[productKey].qty += quantitySigned;
      productBuckets[productKey].revenueCents += netRevenueCents;
      productBuckets[productKey].grossProfitCents += lineGrossProfitCents;

      const categoryKey = String(line.category || 'unknown');
      if (!categoryBuckets[categoryKey]) {
        categoryBuckets[categoryKey] = {
          id: categoryKey,
          name: categoryName,
          qty: 0,
          revenueCents: 0,
          grossProfitCents: 0
        };
      }
      categoryBuckets[categoryKey].qty += quantitySigned;
      categoryBuckets[categoryKey].revenueCents += netRevenueCents;
      categoryBuckets[categoryKey].grossProfitCents += lineGrossProfitCents;
    });

    dailyBuckets[dayKey].grossSalesCents += transactionGrossSalesCents;
    dailyBuckets[dayKey].refundsCents += transactionRefundsCents;
    dailyBuckets[dayKey].netSalesCents += transactionNetSalesCents;
    dailyBuckets[dayKey].discountsCents += transactionDiscountsCents;
    dailyBuckets[dayKey].itemsSold += transactionItemsSold;
    dailyBuckets[dayKey].transactionsCount += 1;
    dailyBuckets[dayKey].grossProfitCents += transactionGrossProfitCents;

    paymentBuckets[paymentType] = (paymentBuckets[paymentType] || 0) + transactionNetSalesCents;

    if (!cashierBuckets[cashier.id]) {
      cashierBuckets[cashier.id] = {
        id: cashier.id,
        name: cashier.name,
        transactionsCount: 0,
        revenueCents: 0,
        grossProfitCents: 0
      };
    }
    cashierBuckets[cashier.id].transactionsCount += 1;
    cashierBuckets[cashier.id].revenueCents += transactionNetSalesCents;
    cashierBuckets[cashier.id].grossProfitCents += transactionGrossProfitCents;

    if (!customerBuckets[customer.id]) {
      customerBuckets[customer.id] = {
        id: customer.id,
        name: customer.name,
        transactionsCount: 0,
        revenueCents: 0,
        onAccountSalesCents: 0
      };
    }
    customerBuckets[customer.id].transactionsCount += 1;
    customerBuckets[customer.id].revenueCents += transactionNetSalesCents;
    if (paymentType === 'On Account') {
      customerBuckets[customer.id].onAccountSalesCents += transactionNetSalesCents;
    }

    const grossItemCount = filteredLines.reduce((sum, line) => sum + (Number.parseInt(line.quantity, 10) || 0), 0);
    const discountMagnitudeCents = Math.abs(transactionDiscountsCents);
    transactionRows.push({
      invoice: transaction.order,
      date: transaction.date || transaction.created_at,
      transactionType,
      till: transaction.till == null ? '—' : transaction.till,
      cashier: cashier.name,
      customer: customer.name,
      paymentType,
      items: transactionItemsSold,
      grossItems: grossItemCount,
      discount: toMoney(transactionDiscountsCents),
      grossSales: toMoney(transactionGrossSalesCents),
      refunds: toMoney(transactionRefundsCents),
      netRevenue: toMoney(transactionNetSalesCents),
      grossProfit: toMoney(transactionGrossProfitCents),
      productSummary: filteredLines.map(line => line.product_display_name || line.product_name || '').join(', '),
      searchText: transactionSearchText,
      discountMagnitude: toMoney(discountMagnitudeCents)
    });

    grossSalesCents += transactionGrossSalesCents;
    refundsCents += transactionRefundsCents;
    netSalesCents += transactionNetSalesCents;
    discountsCents += transactionDiscountsCents;
    itemsSold += transactionItemsSold;
    transactionsCount += 1;
    grossProfitCents += transactionGrossProfitCents;
  });

  const dailyBreakdown = Object.values(dailyBuckets)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(row => {
      const expensesCents = expenseBuckets.byDay[row.date] || 0;
      const netProfitCents = row.grossProfitCents - expensesCents;

      return {
        date: row.date,
        grossSales: toMoney(row.grossSalesCents),
        refunds: toMoney(row.refundsCents),
        netSales: toMoney(row.netSalesCents),
        discounts: toMoney(row.discountsCents),
        transactionsCount: row.transactionsCount,
        itemsSold: row.itemsSold,
        grossProfit: toMoney(row.grossProfitCents),
        totalExpenses: toMoney(expensesCents),
        netProfit: toMoney(netProfitCents)
      };
    });

  const topProducts = sortByRevenueDescending(Object.values(productBuckets))
    .slice(0, 10)
    .map(row => ({
      id: row.id,
      name: row.name,
      qty: row.qty,
      revenue: toMoney(row.revenueCents),
      grossProfit: toMoney(row.grossProfitCents),
      revenueCents: row.revenueCents
    }));

  const topCategories = sortByRevenueDescending(Object.values(categoryBuckets))
    .slice(0, 10)
    .map(row => ({
      id: row.id,
      name: row.name,
      qty: row.qty,
      revenue: toMoney(row.revenueCents),
      grossProfit: toMoney(row.grossProfitCents),
      revenueCents: row.revenueCents
    }));

  const topCashiers = Object.values(cashierBuckets)
    .sort((left, right) => right.revenueCents - left.revenueCents)
    .slice(0, 10)
    .map(row => ({
      id: row.id,
      name: row.name,
      transactionsCount: row.transactionsCount,
      revenue: toMoney(row.revenueCents),
      grossProfit: toMoney(row.grossProfitCents),
      revenueCents: row.revenueCents
    }));

  const topCustomers = Object.values(customerBuckets)
    .sort((left, right) => right.revenueCents - left.revenueCents)
    .slice(0, 10)
    .map(row => ({
      id: row.id,
      name: row.name,
      transactionsCount: row.transactionsCount,
      revenue: toMoney(row.revenueCents),
      onAccountSales: toMoney(row.onAccountSalesCents),
      revenueCents: row.revenueCents
    }));

  const averageOrderValueCents = transactionsCount > 0
    ? Math.round(netSalesCents / transactionsCount)
    : 0;
  const netProfitCents = grossProfitCents - expenseBuckets.totalExpensesCents;

  return {
    summary: {
      grossSales: toMoney(grossSalesCents),
      refunds: toMoney(refundsCents),
      netSales: toMoney(netSalesCents),
      discountsGiven: toMoney(discountsCents),
      transactionsCount,
      itemsSold,
      averageOrderValue: toMoney(averageOrderValueCents),
      cashSales: toMoney(paymentBuckets.Cash || 0),
      cardSales: toMoney(paymentBuckets.Card || 0),
      onAccountSales: toMoney(paymentBuckets['On Account'] || 0),
      grossProfit: toMoney(grossProfitCents),
      totalExpenses: toMoney(expenseBuckets.totalExpensesCents),
      netProfit: toMoney(netProfitCents)
    },
    charts: {
      salesTrend: {
        labels: dailyBreakdown.map(row => row.date),
        datasets: [
          { label: 'Gross Sales', data: dailyBreakdown.map(row => row.grossSales) },
          { label: 'Refunds', data: dailyBreakdown.map(row => row.refunds) },
          { label: 'Net Sales', data: dailyBreakdown.map(row => row.netSales) }
        ]
      },
      profitTrend: {
        labels: dailyBreakdown.map(row => row.date),
        datasets: [
          { label: 'Gross Profit', data: dailyBreakdown.map(row => row.grossProfit) },
          { label: 'Net Profit', data: dailyBreakdown.map(row => row.netProfit) }
        ]
      },
      paymentMix: {
        labels: Object.keys(paymentBuckets),
        data: Object.values(paymentBuckets).map(toMoney)
      },
      categorySales: {
        labels: topCategories.map(row => row.name),
        data: topCategories.map(row => row.revenue)
      },
      topProducts: {
        labels: topProducts.map(row => row.name),
        data: topProducts.map(row => row.revenue)
      },
      topCashiers: {
        labels: topCashiers.map(row => row.name),
        data: topCashiers.map(row => row.revenue)
      },
      topCustomers: {
        labels: topCustomers.map(row => row.name),
        data: topCustomers.map(row => row.revenue)
      }
    },
    tables: {
      dailyBreakdown,
      topProducts,
      topCategories,
      topCashiers,
      topCustomers,
      transactions: transactionRows.sort((left, right) => new Date(right.date) - new Date(left.date))
    },
    filters: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      till: tillFilter,
      cashier: cashierFilter,
      payment: paymentFilter,
      customer: customerFilter,
      category: categoryFilter,
      mode,
      search: searchTerm
    }
  };
}

module.exports = {
  computeSalesReport
};
