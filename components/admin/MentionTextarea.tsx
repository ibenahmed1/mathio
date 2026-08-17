'use client';

import { useMemo, useRef, useState } from 'react';
import type { MembreTache } from '@/lib/types';
import { initiales, avatarClassName } from '@/lib/avatar';

// mentionIds n'est jamais saisi à la main : il est recalculé à chaque frappe
// à partir du texte (recherche de "@NomComplet"), donc toujours cohérent même
// si l'utilisateur supprime une mention après coup.
function extraireMentionIds(texte: string, membres: MembreTache[]): string[] {
  return membres.filter((m) => texte.includes(`@${m.nomComplet}`)).map((m) => m.id);
}

export function MentionTextarea({
  value,
  onChange,
  membres,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (texte: string, mentionIds: string[]) => void;
  membres: MembreTache[];
  placeholder?: string;
  rows?: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [requete, setRequete] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    if (!ouvert) return [];
    const q = requete.toLowerCase();
    return membres.filter((m) => m.nomComplet.toLowerCase().includes(q)).slice(0, 6);
  }, [ouvert, requete, membres]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const texte = e.target.value;
    const pos = e.target.selectionStart ?? texte.length;
    const avantCurseur = texte.slice(0, pos);
    const match = avantCurseur.match(/@([^\s@]*)$/);
    if (match) {
      setOuvert(true);
      setRequete(match[1]);
    } else {
      setOuvert(false);
    }
    onChange(texte, extraireMentionIds(texte, membres));
  }

  function choisir(membre: MembreTache) {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? value.length;
    const avantCurseur = value.slice(0, pos);
    const apresCurseur = value.slice(pos);
    const nouveauAvant = avantCurseur.replace(/@([^\s@]*)$/, `@${membre.nomComplet} `);
    const texte = nouveauAvant + apresCurseur;
    setOuvert(false);
    onChange(texte, extraireMentionIds(texte, membres));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nouveauAvant.length, nouveauAvant.length);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className="kdc-textarea w-full px-3 py-2 text-sm"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
      />
      {ouvert && suggestions.length > 0 && (
        <div
          className="absolute bottom-full z-10 mb-1 w-full max-w-xs overflow-hidden rounded-[var(--r-control)] border shadow-lg"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-panel-solid)' }}
        >
          {suggestions.map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choisir(m)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
            >
              <span className={`kdc-avatar ${avatarClassName(m.nomComplet)}`}>{initiales(m.nomComplet)}</span>
              {m.nomComplet}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
