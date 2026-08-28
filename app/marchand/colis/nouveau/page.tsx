'use client';

import Link from 'next/link';
import { NouveauColisForm } from '@/components/colis/NouveauColisForm';

// Formulaire partagé avec /admin/colis/nouveau ; ici le marchand est implicite
// (déduit de la session), la section « Marchand » disparaît donc
// — cf. components/colis/NouveauColisForm.tsx.
export default function NouveauColisPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Nouveau colis</h1>
        <Link href="/marchand/colis" className="text-sm font-semibold opacity-60 hover:opacity-100">
          ← Retour aux colis
        </Link>
      </div>
      <NouveauColisForm mode="marchand" />
    </div>
  );
}
