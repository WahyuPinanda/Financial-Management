import { Sprout } from 'lucide-react';

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">
        <Sprout size={25} strokeWidth={1.8} />
      </span>
      <span>
        Cash Flow<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
