const { decimalCents, decimalMoney } = require('./money');
const DAY = 86400000;
const names = {
  harvest: 'Pengeluaran panen',
  garden: 'Pengeluaran kebun',
  other: 'Pengeluaran lainnya',
  savings_expense: 'Belanja Tabungan',
  investment_expense: 'Belanja Investasi',
};
function financeReminders({ budgets = [], goals = [], templates = [] }, today) {
  const day = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(day)) throw new Error('Tanggal pengingat tidak valid.');
  const reminders = [];
  for (const b of budgets) {
    const amount = decimalCents(b.amount),
      spent = decimalCents(b.spent);
    if (amount <= 0n || spent * 100n < amount * 80n) continue;
    const exceeded = spent > amount;
    reminders.push({
      id: `budget:${b.id}`,
      severity: exceeded ? 'warning' : 'info',
      title: `${names[b.category] ?? b.category}: ${exceeded ? 'melewati' : 'mendekati'} anggaran`,
      amount: decimalMoney(exceeded ? spent - amount : amount - spent),
      detail: exceeded ? 'Kelebihan anggaran bulan ini' : 'Sisa anggaran bulan ini',
      route: '/anggaran',
    });
  }
  for (const g of goals) {
    const remaining = decimalCents(g.target) - decimalCents(g.balance),
      days = Math.ceil((Date.parse(`${g.due_date}T00:00:00Z`) - day) / DAY);
    if (remaining <= 0n || !Number.isFinite(days) || days > 14) continue;
    reminders.push({
      id: `goal:${g.id}`,
      severity: days < 0 ? 'warning' : 'info',
      title: g.name,
      amount: decimalMoney(remaining),
      detail:
        days < 0
          ? `Lewat tenggat ${-days} hari · sisa target`
          : days === 0
            ? 'Tenggat hari ini · sisa target'
            : `Tenggat ${days} hari lagi · sisa target`,
      route: g.kind === 'investment' ? '/future-investment-goals' : '/tabungan',
    });
  }
  for (const t of templates) {
    if (!t.active || t.next_date > today) continue;
    reminders.push({
      id: `template:${t.id}`,
      severity: 'info',
      title: t.name,
      detail: 'Transaksi rutin menunggu pemeriksaan Anda',
      route: '/template-transaksi',
    });
  }
  return reminders.sort(
    (a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning'),
  );
}
module.exports = { financeReminders };
