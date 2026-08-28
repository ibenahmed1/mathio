'use client';

import { NouveauColisForm } from '@/components/colis/NouveauColisForm';

// Le formulaire est partagé avec /marchand/colis/nouveau : seule la section
// « Marchand » (choix du marchand, dont dépendent catalogue et stock) est
// propre à l'admin — cf. components/colis/NouveauColisForm.tsx.
export default function AdminNouveauColisPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">Nouveau colis</h1>
      <NouveauColisForm mode="admin" />
    </div>
  );
}
