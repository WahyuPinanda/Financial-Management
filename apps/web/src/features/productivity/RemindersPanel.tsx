import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronDown } from 'lucide-react';
import { financeReminders, type FinanceSnapshot, type ProductivitySnapshot } from '@sawit/shared';
import { rupiah, today } from '../../lib/format';
export function RemindersPanel({
  finance,
  productivity,
  preview,
}: {
  finance?: FinanceSnapshot;
  productivity?: ProductivitySnapshot;
  preview: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const reminders = financeReminders(
    {
      budgets: productivity?.reminderBudgets,
      goals: finance?.goals,
      templates: productivity?.templates,
    },
    today(),
  );
  if (!reminders.length) return null;
  const rows = expanded ? reminders : reminders.slice(0, 3);
  return (
    <section className="panel finance-panel reminders-panel" aria-label="Pengingat keuangan">
      <div className="panel-heading">
        <div>
          <h2>
            <Bell size={18} /> Pengingat keuangan <span className="badge">{reminders.length}</span>
          </h2>
          <p>Anggaran bulan berjalan, target dalam 14 hari, dan transaksi rutin jatuh tempo.</p>
        </div>
      </div>
      <div className="reminder-list">
        {rows.map((r) => (
          <Link
            className={`reminder-item ${r.severity}`}
            key={r.id}
            to={preview ? `/preview${r.route}` : r.route}
          >
            <strong>{r.title}</strong>
            <span>
              {r.detail}
              {r.amount !== undefined ? ` · ${rupiah(r.amount)}` : ''}
            </span>
          </Link>
        ))}
      </div>
      {reminders.length > 3 && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Ringkas pengingat' : 'Lihat semua pengingat'} <ChevronDown size={15} />
        </button>
      )}
    </section>
  );
}
