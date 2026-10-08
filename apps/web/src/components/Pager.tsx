export function Pager({
  count,
  page,
  hasNext,
  disabled,
  onPrevious,
  onNext,
}: {
  count: number;
  page: number;
  hasNext: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (count <= 20 && page === 1) return null;
  return (
    <div className="records-pager">
      <span>
        Halaman {page} · {count} catatan · maksimal 20 per halaman
      </span>
      <div>
        <button
          className="button secondary compact"
          disabled={disabled || page === 1}
          onClick={onPrevious}
        >
          Sebelumnya
        </button>
        <button
          className="button secondary compact"
          disabled={disabled || !hasNext}
          onClick={onNext}
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}
