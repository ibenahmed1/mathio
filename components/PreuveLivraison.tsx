'use client';

import { useState } from 'react';
import { Camera, PenLine, X } from 'lucide-react';

// § Preuve de livraison (RG-02) : photo et/ou signature capturées par le
// livreur au moment du "Livré" (§ /livreur/colis), stockées en data URL dans
// Commande.photoPreuveUrl / signatureUrl — même convention que Commande.cinUrl,
// pas de stockage objet dans ce projet. Ce composant est le seul endroit qui
// les rend : réutilisé par le suivi admin, le suivi marchand et l'écran de
// clôture de tournée, pour que les trois montrent exactement la même chose.
//
// Les vignettes sont volontairement petites (une data URL de photo pèse
// quelques centaines de Ko) et s'ouvrent en plein écran au clic — un lien
// vers une data URL est bloqué par la plupart des navigateurs, d'où la
// visionneuse intégrée plutôt qu'un target="_blank".
export function PreuveLivraison({
  photoPreuveUrl,
  signatureUrl,
  dateLivraison,
  compact,
}: {
  photoPreuveUrl?: string | null;
  signatureUrl?: string | null;
  dateLivraison?: string | null;
  compact?: boolean;
}) {
  const [plein, setPlein] = useState<{ src: string; titre: string } | null>(null);

  if (!photoPreuveUrl && !signatureUrl) {
    return compact ? null : (
      <p className="text-xs opacity-60">Aucune preuve de livraison enregistrée pour ce colis.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <p className="text-xs font-semibold opacity-70">
          Preuve de livraison
          {dateLivraison && <span className="font-normal opacity-70"> — {new Date(dateLivraison).toLocaleString('fr-FR')}</span>}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {photoPreuveUrl && (
          <button
            type="button"
            onClick={() => setPlein({ src: photoPreuveUrl, titre: 'Photo de livraison' })}
            className="flex flex-col items-center gap-1 rounded-lg border border-black/10 p-1.5 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreuveUrl} alt="Photo de livraison" className="h-24 w-24 rounded object-cover" />
            <span className="flex items-center gap-1 text-[11px] font-semibold opacity-70">
              <Camera className="h-3 w-3" />
              Photo
            </span>
          </button>
        )}
        {signatureUrl && (
          <button
            type="button"
            onClick={() => setPlein({ src: signatureUrl, titre: 'Signature du client' })}
            className="flex flex-col items-center gap-1 rounded-lg border border-black/10 p-1.5 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signatureUrl} alt="Signature du client" className="h-24 w-40 rounded bg-white object-contain" />
            <span className="flex items-center gap-1 text-[11px] font-semibold opacity-70">
              <PenLine className="h-3 w-3" />
              Signature
            </span>
          </button>
        )}
      </div>

      {plein && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
          onClick={() => setPlein(null)}
        >
          <div className="flex w-full max-w-3xl items-center justify-between text-white">
            <span className="text-sm font-semibold">{plein.titre}</span>
            <button type="button" onClick={() => setPlein(null)} aria-label="Fermer" className="rounded-md p-1 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={plein.src} alt={plein.titre} className="max-h-[80vh] max-w-full rounded-lg bg-white object-contain" />
        </div>
      )}
    </div>
  );
}
