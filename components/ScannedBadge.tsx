import { ScanLine } from 'lucide-react';

export function ScannedBadge({ scanne }: { scanne: boolean }) {
  if (scanne) {
    return (
      <span className="badge bg-brand text-brand-foreground">
        <ScanLine className="h-3 w-3" /> Scanné
      </span>
    );
  }
  return <span className="badge badge-neutral">Manuel</span>;
}
