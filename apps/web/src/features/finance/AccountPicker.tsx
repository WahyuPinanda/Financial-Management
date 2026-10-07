import type { FinanceAccount } from '@sawit/shared';
export function AccountPicker({
  accounts,
  kinds,
  value,
  onChange,
  label = 'Rekening',
  disabled = false,
}: {
  accounts: FinanceAccount[];
  kinds: FinanceAccount['kind'][];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required>
        <option value="">Pilih rekening</option>
        {accounts
          .filter((a) => kinds.includes(a.kind))
          .map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </label>
  );
}
