import Link from 'next/link';
import { SquarePen } from 'lucide-react';

export default function ModificationColisPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Modification des colis</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-black/20 px-6 py-16 text-center dark:border-white/20">
        <SquarePen className="h-10 w-10 text-brand" />
        <p className="text-sm font-semibold">La modification se fait directement depuis la liste des colis</p>
        <p className="max-w-md text-sm opacity-60">
          Ouvrez le menu &laquo; Actions &raquo; d&apos;un colis (ville, prix, informations, CIN, livreur…) depuis la liste.
        </p>
        <Link href="/admin/commandes" className="btn-primary">
          Aller à la liste des colis
        </Link>
      </div>
    </div>
  );
}
