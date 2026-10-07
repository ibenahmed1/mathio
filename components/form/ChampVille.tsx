'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { cleRecherche as cle, proposerVilles, replier, type OptionVille } from '@/lib/recherche-ville';

// § Saisie des villes — UN seul champ pour toute l'application (admin,
// marchand, terrain) : une liste déroulante qui se filtre à chaque lettre
// tapée, sans tenir compte des accents ni de la casse (« fes » → « Fès »,
// « taza » → « Taza Ville »).
//
// Deux usages :
//   · SAISIE (par défaut) : la valeur doit être une ville de la liste. Ce qui
//     est tapé sans être choisi n'est pas retenu — c'est ce qui empêchait
//     jusqu'ici « casa test » ou un numéro de téléphone d'entrer comme ville ;
//   · FILTRE (`libre`) : la liste propose, mais le texte tapé vaut tel quel.
//
// Sans `options`, la liste est celle des villes livrables
// (/api/referentiel/villes), chargée une fois par page et partagée par tous
// les champs.
//
// Avec `name`, la valeur part aussi dans un champ caché, pour les formulaires
// lus par FormData.

export type { OptionVille };

let referentiel: Promise<OptionVille[]> | null = null;

function chargerReferentiel(): Promise<OptionVille[]> {
  if (!referentiel) {
    referentiel = apiGet<{ data: { nom: string }[] }>('/api/referentiel/villes')
      .then((res) => res.data.map((v) => ({ valeur: v.nom, libelle: v.nom })))
      .catch((err) => {
        referentiel = null; // un échec réseau ne doit pas figer la liste vide
        throw err;
      });
  }
  return referentiel;
}

const MAX_PROPOSITIONS = 80;

export function ChampVille({
  value,
  onChange,
  options,
  libre = false,
  required,
  disabled,
  placeholder = 'Tapez une ville…',
  name,
  id,
  className,
  autoFocus,
  onEnter,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (valeur: string) => void;
  options?: OptionVille[] | readonly string[];
  libre?: boolean;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  'aria-label'?: string;
}) {
  const [villesReferentiel, setVillesReferentiel] = useState<OptionVille[] | null>(null);
  const [erreurChargement, setErreurChargement] = useState(false);
  const liste = useMemo<OptionVille[]>(() => {
    if (options) return options.map((o) => (typeof o === 'string' ? { valeur: o, libelle: o } : o));
    return villesReferentiel ?? [];
  }, [options, villesReferentiel]);

  useEffect(() => {
    if (options) return;
    let vivant = true;
    chargerReferentiel()
      .then((v) => vivant && setVillesReferentiel(v))
      .catch(() => vivant && setErreurChargement(true));
    return () => {
      vivant = false;
    };
  }, [options]);

  const libelleDe = (v: string) => liste.find((o) => o.valeur === v)?.libelle ?? v;

  const [saisie, setSaisie] = useState(() => libelleDe(value));
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const focus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Un filtre relancé juste après un choix doit lire la NOUVELLE valeur : on
  // appelle la version de `onEnter` du rendu suivant, pas celle d'avant.
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  });
  const relancer = () => setTimeout(() => onEnterRef.current?.(), 0);
  const listeRef = useRef<HTMLUListElement>(null);
  const idListe = useId();
  const idChamp = id ?? `${idListe}-champ`;

  // La valeur change de l'extérieur (formulaire réinitialisé, liste arrivée) :
  // le texte affiché suit, sauf pendant que l'utilisateur tape.
  useEffect(() => {
    if (focus.current) return;
    queueMicrotask(() => setSaisie(libelleDe(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, liste]);

  const propositions = useMemo(() => {
    // Ville déjà choisie et non retouchée : on montre toute la liste.
    if (!libre && value && libelleDe(value) === saisie) return liste.slice(0, MAX_PROPOSITIONS);
    return proposerVilles(saisie, liste, MAX_PROPOSITIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisie, liste, libre, value]);

  // Champ de saisie : un texte tapé sans être choisi rend le champ invalide,
  // ce qui bloque l'envoi d'un formulaire natif avec un message clair.
  const nonChoisi = !libre && cle(saisie) !== '' && (!value || cle(libelleDe(value)) !== cle(saisie));
  useEffect(() => {
    inputRef.current?.setCustomValidity(nonChoisi ? 'Choisissez une ville dans la liste.' : '');
  }, [nonChoisi]);

  // L'élément actif reste visible quand on descend au clavier.
  useEffect(() => {
    if (!ouvert) return;
    listeRef.current?.querySelector<HTMLElement>(`[data-index="${actif}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [actif, ouvert]);

  function choisir(o: OptionVille) {
    setSaisie(o.libelle);
    onChange(o.valeur);
    setOuvert(false);
  }

  function taper(texte: string) {
    setSaisie(texte);
    setOuvert(true);
    setActif(0);
    if (libre) {
      onChange(texte);
      return;
    }
    // Saisie exacte d'une ville de la liste : retenue sans avoir à cliquer.
    const exacte = liste.find((o) => cle(o.libelle) === cle(texte));
    onChange(exacte ? exacte.valeur : '');
  }

  function quitter() {
    focus.current = false;
    setOuvert(false);
    if (libre) return;
    // En saisie, un texte qui ne désigne qu'une seule ville la retient ;
    // sinon il reste affiché, marqué invalide, jusqu'à un vrai choix.
    if (!value && propositions.length === 1 && cle(saisie) !== '') choisir(propositions[0]);
  }

  function clavier(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!ouvert) setOuvert(true);
      else setActif((i) => Math.min(i + 1, propositions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActif((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (ouvert && propositions[actif]) {
        e.preventDefault();
        choisir(propositions[actif]);
        if (libre) relancer();
      } else if (onEnter) {
        e.preventDefault();
        onEnter();
      }
    } else if (e.key === 'Escape') {
      if (ouvert) {
        e.preventDefault();
        setOuvert(false);
      }
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
      <input
        ref={inputRef}
        id={idChamp}
        className="input-basic w-full pl-9 pr-8"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={ouvert}
        aria-controls={idListe}
        aria-autocomplete="list"
        aria-activedescendant={ouvert && propositions[actif] ? `${idListe}-${actif}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={saisie}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => taper(e.target.value)}
        onFocus={() => {
          focus.current = true;
          setOuvert(true);
        }}
        onBlur={quitter}
        onKeyDown={clavier}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
      {name && <input type="hidden" name={name} value={value} />}

      {ouvert && !disabled && (
        <ul
          ref={listeRef}
          id={idListe}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          {propositions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
              {erreurChargement
                ? 'Liste des villes indisponible — réessayez.'
                : !options && !villesReferentiel
                  ? 'Chargement des villes…'
                  : libre
                    ? 'Aucune ville connue ne correspond'
                    : 'Aucune ville ne correspond'}
            </li>
          ) : (
            propositions.map((o, i) => (
              <li
                key={o.valeur}
                id={`${idListe}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.valeur === value}
                // mousedown et non click : le clic arriverait après le blur, qui
                // a déjà fermé la liste.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choisir(o);
                  if (libre) relancer();
                }}
                onMouseEnter={() => setActif(i)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm pointer-coarse:py-2.5 ${
                  i === actif ? 'bg-brand/[0.15]' : ''
                } ${o.valeur === value ? 'font-semibold' : ''}`}
              >
                <Surligne texte={o.libelle} motif={cle(saisie)} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// Variante pour les formulaires lus par FormData, sans état chez l'appelant :
// le champ garde sa valeur lui-même et la transmet sous `name`.
export function ChampVilleFormulaire({
  name,
  defaultValue = '',
  ...props
}: Omit<Parameters<typeof ChampVille>[0], 'value' | 'onChange' | 'name'> & { name: string; defaultValue?: string }) {
  const [valeur, setValeur] = useState(defaultValue);
  return <ChampVille {...props} name={name} value={valeur} onChange={setValeur} />;
}

// Met en gras la partie tapée, à sa place dans le nom d'origine.
function Surligne({ texte, motif }: { texte: string; motif: string }) {
  if (!motif) return <>{texte}</>;
  const replie = [...texte].map(replier).join('');
  const debut = replie.indexOf(motif);
  if (debut < 0) return <>{texte}</>;
  const lettres = [...texte];
  return (
    <>
      {lettres.slice(0, debut).join('')}
      <strong className="font-bold">{lettres.slice(debut, debut + motif.length).join('')}</strong>
      {lettres.slice(debut + motif.length).join('')}
    </>
  );
}
