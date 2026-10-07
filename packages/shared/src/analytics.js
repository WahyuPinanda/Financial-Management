const toCents = (value) => BigInt(Math.round(Number(value) * 100));
const fromCents = (value) => Number(value) / 100;

function growthPercent(current, previous) {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Financial dates determine the reporting period; publication determines inclusion. */
function cashFlowEvents(harvests, expenses) {
  const events = [];
  for (const harvest of harvests) {
    for (const spk of harvest.spks)
      if (spk.published_at) {
        events.push({ date: spk.delivery_date, type: 'income', amount: Number(spk.total_income) });
      }
    for (const expense of harvest.expenses)
      if (expense.published_at) {
        events.push({
          date: harvest.harvest_date,
          type: 'harvest',
          amount: Number(expense.total_expense),
        });
      }
  }
  for (const expense of expenses)
    if (expense.published_at) {
      events.push({
        date: expense.expense_date,
        type: expense.category,
        amount: Number(expense.total_expense),
      });
    }
  return events;
}

function analyzeCashFlow(harvests, expenses, options) {
  const { period, year, asOf } = options;
  if (
    !['month', 'year'].includes(period) ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999
  ) {
    throw new Error('Periode analisis tidak valid.');
  }
  const events = cashFlowEvents(harvests, expenses);
  const buckets = new Map();
  for (const event of events) {
    const key = event.date.slice(0, period === 'month' ? 7 : 4);
    const bucket = buckets.get(key) || {
      income: 0n,
      other_income: 0n,
      harvest: 0n,
      garden: 0n,
      other: 0n,
      savings: 0n,
      investment: 0n,
      savings_expense: 0n,
      investment_expense: 0n,
    };
    bucket[event.type] += toCents(event.amount);
    buckets.set(key, bucket);
  }
  const keys = [];
  if (period === 'month') {
    const lastMonth = asOf?.slice(0, 4) === String(year) ? Number(asOf.slice(5, 7)) : 12;
    for (let month = 1; month <= lastMonth; month++)
      keys.push(`${year}-${String(month).padStart(2, '0')}`);
  } else {
    const firstYear = events.reduce(
      (earliest, event) => Math.min(earliest, Number(event.date.slice(0, 4))),
      year,
    );
    for (
      let current = Math.max(1900, year - 9, Math.min(firstYear, year));
      current <= year;
      current++
    )
      keys.push(String(current));
  }
  const net = (bucket) =>
    bucket
      ? bucket.income +
        bucket.other_income -
        bucket.harvest -
        bucket.garden -
        bucket.other -
        bucket.savings -
        bucket.investment -
        bucket.savings_expense -
        bucket.investment_expense
      : 0n;
  let closing = [...buckets.entries()]
    .filter(([key]) => key < keys[0])
    .reduce((sum, [, bucket]) => sum + net(bucket), 0n);
  return keys.map((key) => {
    const bucket = buckets.get(key) || {
      income: 0n,
      other_income: 0n,
      harvest: 0n,
      garden: 0n,
      other: 0n,
      savings: 0n,
      investment: 0n,
      savings_expense: 0n,
      investment_expense: 0n,
    };
    const current = net(bucket);
    const previousKey =
      period === 'year'
        ? String(Number(key) - 1)
        : key.endsWith('-01')
          ? `${year - 1}-12`
          : `${year}-${String(Number(key.slice(5)) - 1).padStart(2, '0')}`;
    const previous = net(buckets.get(previousKey));
    const opening = closing;
    closing += current;
    return {
      key,
      income: fromCents(bucket.income + bucket.other_income),
      otherIncome: fromCents(bucket.other_income),
      expenses: fromCents(
        bucket.harvest +
          bucket.garden +
          bucket.other +
          bucket.savings +
          bucket.investment +
          bucket.savings_expense +
          bucket.investment_expense,
      ),
      harvestExpenses: fromCents(bucket.harvest),
      gardenExpenses: fromCents(bucket.garden),
      otherExpenses: fromCents(bucket.other),
      savingsAllocations: fromCents(bucket.savings),
      investmentAllocations: fromCents(bucket.investment),
      savingsExpenses: fromCents(bucket.savings_expense),
      investmentExpenses: fromCents(bucket.investment_expense),
      net: fromCents(current),
      openingCash: fromCents(opening),
      closingCash: fromCents(closing),
      previousNet: fromCents(previous),
      growthPercent: growthPercent(fromCents(current), fromCents(previous)),
      partial: key === asOf?.slice(0, period === 'month' ? 7 : 4),
    };
  });
}
module.exports = { growthPercent, cashFlowEvents, analyzeCashFlow };
