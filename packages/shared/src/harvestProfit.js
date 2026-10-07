const { decimalCents, decimalMoney, sumDecimalMoney } = require('./money');
function calculateHarvestProfit(harvest, gardenCost = '0.00') {
  const spks = harvest.spks.filter((s) => s.published_at),
    expenses = harvest.expenses.filter((e) => e.published_at);
  const income = sumDecimalMoney(spks.map((s) => s.total_income)),
    netWeight = sumDecimalMoney(spks.map((s) => s.net_weight));
  const harvestCost = sumDecimalMoney(expenses.map((e) => e.total_expense)),
    totalCost = sumDecimalMoney([harvestCost, gardenCost]);
  const profit = decimalMoney(decimalCents(income) - decimalCents(totalCost)),
    weight = decimalCents(netWeight);
  const incomeCents = decimalCents(income),
    profitCents = decimalCents(profit);
  const margin =
    incomeCents > 0n
      ? (Number(
          ((profitCents < 0n ? -profitCents : profitCents) * 10000n + incomeCents / 2n) /
            incomeCents,
        ) /
          100) *
        (profitCents < 0n ? -1 : 1)
      : null;
  return {
    id: harvest.id,
    name: harvest.name,
    harvest_date: harvest.harvest_date,
    income,
    netWeight,
    harvestCost,
    gardenCost,
    totalCost,
    profit,
    costPerKg:
      weight > 0n ? decimalMoney((decimalCents(totalCost) * 100n + weight / 2n) / weight) : null,
    marginPercent: margin,
  };
}
module.exports = { calculateHarvestProfit };
