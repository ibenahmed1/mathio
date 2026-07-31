import type { LucideIcon } from 'lucide-react';

export function ComingSoon({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">{title}</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-black/20 px-6 py-16 text-center dark:border-white/20">
        <Icon className="h-10 w-10 text-brand" />
        <p className="text-sm font-semibold">Fonctionnalité à venir</p>
        <p className="max-w-md text-sm opacity-60">{description}</p>
      </div>
    </div>
  );
}
