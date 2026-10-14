'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { lireDouchette } from '@/lib/douchette';

// Champ dédié à la douchette : le lecteur se comporte comme un clavier qui
// tape le code puis Entrée. Le champ se vide après chaque code et garde le
// focus pour enchaîner les colis sans toucher la souris. Sert aussi de saisie
// manuelle au clavier.
export function ChampDouchette({
  onScan,
  disabled,
  label = 'Douchette',
  placeholder = 'Scanner ou saisir PD-000000',
}: {
  onScan: (raw: string, source: 'manual') => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [valeur, setValeur] = useState('');
  const [alerte, setAlerte] = useState<string | null>(null);

  // Focus automatique seulement avec un pointeur précis (poste équipé d'une
  // douchette) : sur téléphone, il ouvrirait le clavier par-dessus la caméra.
  useEffect(() => {
    if (!disabled && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [disabled]);

  const minuteurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (minuteurRef.current) clearTimeout(minuteurRef.current);
  }, []);

  function envoyer(code: string) {
    if (minuteurRef.current) clearTimeout(minuteurRef.current);
    setAlerte(null);
    onScan(code, 'manual');
    setValeur('');
  }

  function changer(v: string) {
    // QR complet (signature comprise) : envoyé tout de suite, sans attendre
    // l'Entrée que la douchette a déjà tapé trop tôt.
    const lecture = lireDouchette(v);
    if (lecture.etat === 'complet' && lecture.qr && !disabled) envoyer(lecture.code);
    else setValeur(v);
  }

  function valider(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const lecture = lireDouchette(valeur);
    if (lecture.etat === 'complet') return envoyer(lecture.code);
    if (lecture.etat === 'attente') {
      // Entrée tapé au milieu du QR : la signature suit normalement dans la
      // foulée. Si rien n'arrive, on le dit plutôt que de rester muet.
      if (minuteurRef.current) clearTimeout(minuteurRef.current);
      minuteurRef.current = setTimeout(() => {
        setAlerte(`QR lu incomplet (« ${valeur.trim()} ») : la fin du code n'est pas arrivée. Rescannez le colis.`);
        setValeur('');
      }, 1500);
    }
  }

  return (
    <form onSubmit={valider} className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs font-semibold opacity-70">
        <ScanBarcode className="h-4 w-4" />
        {label}
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="input-basic flex-1 font-mono"
          placeholder={placeholder}
          value={valeur}
          onChange={(e) => changer(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={disabled || !valeur.trim()}>
          Valider
        </button>
      </div>
      {alerte && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {alerte}
        </p>
      )}
    </form>
  );
}
