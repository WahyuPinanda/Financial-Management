import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
export function SidebarGroup({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches),
    [open, setOpen] = useState(active);
  const id = useId();
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => setOpen(active), [active]);
  return (
    <div className="nav-group" role="group" aria-label={label}>
      <span className="nav-group-label" hidden={mobile}>
        {label}
      </span>
      <button
        type="button"
        className="nav-group-toggle"
        hidden={!mobile}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown size={15} className={open ? 'expanded' : ''} />
      </button>
      <div className="nav-group-content" id={id} hidden={mobile && !open}>
        {children}
      </div>
    </div>
  );
}
