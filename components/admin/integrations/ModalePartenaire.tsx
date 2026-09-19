'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Plus, Store, Truck } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import type { PlateformeDetail, PlateformeResume } from '@/lib/types';
import { codeDepuisNom, type NaturePlateforme } from '@/components/admin/integrations/scopes';

// Un SEUL formulaire pour créer et pour modifier un compte machine.
//
// Deux formulaires jumeaux auraient divergé à la première règle ajoutée : la
// nature, le code proposé, le rattachement et leurs verrous sont exactement les
// mêmes questions, posées au même endroit. Ce qui change entre les deux modes,
// ce ne sont pas les champs mais ce qui est encore MODIFIABLE — et cela, le
// serveur le dit (`PlateformeDetail.modifiables`), l'écran ne le devine pas.

interface Transporteur {
  id: string;
  nom: string;
}

// Valeur sentinelle du <select> ouvrant la saisie d'un nouveau transporteur.
// Un identifiant réel est un UUID, cette chaîne n'en sera donc jamais un.
const NOUVEAU = '__nouveau__';

export function ModalePartenaire({
  existant,
  onClose,
  onEnregistre,
}: {
  /** Absent en création. Présent, il porte aussi l'état des verrous. */
  existant?: PlateformeDetail;
  onClose: () => void;
  onEnregistre: (plateforme: PlateformeResume) => void;
}) {
  const edition = existant !== undefined;

  const [nature, setNature] = useState<NaturePlateforme>(
    existant?.prestataire ? 'transporteur' : 'vente'
  );
  const [nom, setNom] = useState(existant?.nom ?? '');
  // Le pré-remplissage du nom d'après le transporteur ne doit jamais écraser
  // une saisie : ce drapeau distingue « vide » de « laissé tel quel ».
  const [nomSaisi, setNomSaisi] = useState(edition);
  const [code, setCode] = useState(existant?.code ?? '');
  const [prestataireId, setPrestataireId] = useState(existant?.prestataire?.id ?? '');

  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [erreurTransporteurs, setErreurTransporteurs] = useState<string | null>(null);
  // Saisie en ligne d'un transporteur absent du référentiel. En ligne plutôt
  // qu'en seconde modale : empiler deux fenêtres pour un champ de texte fait
  // perdre le contexte du formulaire qu'on est en train de remplir.
  const [saisieNouveau, setSaisieNouveau] = useState(false);
  const [nouveauNom, setNouveauNom] = useState('');
  const [creationTransporteur, setCreationTransporteur] = useState(false);

  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Ce que le serveur autorise encore à changer. En création, tout est ouvert.
  const verrous = existant?.modifiables;
  const codeModifiable = !edition || Boolean(verrous?.code);
  const rattachementModifiable = !edition || Boolean(verrous?.prestataire);

  // Les transporteurs qui n'ont pas encore de compte machine. Une liste vide et
  // un référentiel injoignable mènent au même écran vide mais ne se corrigent
  // pas pareil, donc ils ne portent pas le même message — les confondre en
  // masquant le champ laisse chercher une option qui n'a jamais été proposée.
  useEffect(() => {
    apiGet<Transporteur[]>('/api/plateformes/transporteurs')
      .then((liste) => {
        setTransporteurs(liste);
        setErreurTransporteurs(null);
      })
      .catch((e) =>
        setErreurTransporteurs(e instanceof Error ? e.message : 'Référentiel injoignable')
      );
  }, []);

  // En édition, le transporteur DÉJÀ rattaché ne figure pas dans la liste des
  // disponibles — elle ne retient que ceux qui sont encore libres. Sans cet
  // ajout, rouvrir le formulaire afficherait « Choisir un transporteur… » sur
  // un compte qui en a un, et l'enregistrer le détacherait en silence.
  const options = useMemo(() => {
    const actuel = existant?.prestataire;
    if (!actuel || transporteurs.some((t) => t.id === actuel.id)) return transporteurs;
    return [actuel, ...transporteurs];
  }, [transporteurs, existant]);

  function choisirNature(choisie: NaturePlateforme) {
    if (!rattachementModifiable) return;
    setNature(choisie);
    // Repasser en canal de vente délie VRAIMENT : garder l'identifiant choisi
    // avant créerait un transporteur sous un formulaire qui n'en montre plus.
    if (choisie === 'vente') setPrestataireId('');
  }

  function choisirTransporteur(id: string) {
    setPrestataireId(id);
    const choisi = options.find((t) => t.id === id);
    if (choisi && !nomSaisi) setNom(choisi.nom);
  }

  async function creerTransporteur() {
    const valeur = nouveauNom.trim();
    if (!valeur) return;
    setCreationTransporteur(true);
    setErreur(null);
    try {
      const cree = await apiPost<Transporteur>('/api/plateformes/transporteurs', { nom: valeur });
      setTransporteurs((liste) => [...liste, cree].sort((a, b) => a.nom.localeCompare(b.nom)));
      setNouveauNom('');
      setSaisieNouveau(false);
      setPrestataireId(cree.id);
      if (!nomSaisi) setNom(cree.nom);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Création impossible');
    } finally {
      setCreationTransporteur(false);
    }
  }

  const codePropose = useMemo(() => codeDepuisNom(nom), [nom]);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      if (edition) {
        // On n'envoie QUE ce qui a bougé et ce qui a le droit de bouger : un
        // `code` identique renvoyé sur un compte verrouillé passerait la garde
        // serveur (elle compare à l'existant), mais un `prestataireId` renvoyé
        // à l'aveugle sur un compte verrouillé, non. Filtrer ici évite d'avoir
        // à s'en remettre à cette subtilité.
        const corps: Record<string, unknown> = { nom: nom.trim() };
        if (codeModifiable) corps.code = (code || codePropose).trim();
        if (rattachementModifiable) {
          corps.prestataireId = nature === 'transporteur' ? prestataireId : null;
        }
        onEnregistre(await apiPatch<PlateformeResume>(`/api/plateformes/${existant.id}`, corps));
      } else {
        onEnregistre(
          await apiPost<PlateformeResume>('/api/plateformes', {
            nom: nom.trim(),
            code: (code || codePropose).trim(),
            prestataireId: nature === 'transporteur' ? prestataireId : undefined,
          })
        );
      }
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      title={edition ? `Modifier — ${existant.nom}` : 'Nouveau partenaire'}
      onClose={onClose}
      size="sm"
    >
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <Field
          label="Type de partenaire"
          required
          hint={
            rattachementModifiable
              ? 'Il décide des permissions accordables aux clés du compte.'
              : undefined
          }
          error={
            rattachementModifiable
              ? undefined
              : 'Verrouillé : ce compte a des clés actives. Les révoquer ou les expirer d’abord — déplacer le périmètre sous une clé déjà déployée changerait ce qu’elle peut faire sans que le partenaire en soit averti.'
          }
        >
          <div className="btn-row">
            <button
              type="button"
              className={nature === 'vente' ? 'btn-dark btn-sm' : 'btn-outline btn-sm'}
              onClick={() => choisirNature('vente')}
              disabled={!rattachementModifiable}
            >
              <Store size={14} /> Canal de vente
            </button>
            <button
              type="button"
              className={nature === 'transporteur' ? 'btn-dark btn-sm' : 'btn-outline btn-sm'}
              onClick={() => choisirNature('transporteur')}
              disabled={!rattachementModifiable}
            >
              <Truck size={14} /> Transporteur
            </button>
          </div>
          <span className="mt-1 block text-[11px] text-black/50 dark:text-white/50">
            {nature === 'vente'
              ? 'Nous envoie ses marchands et dépose des colis (Shipeh).'
              : 'Sous-traitant à qui on confie des colis : il nous en déclare l’issue.'}
          </span>
        </Field>

        {nature === 'transporteur' && (
          <Field
            label="Transporteur"
            required
            hint="Choisi dans le référentiel de sous-traitance. Un transporteur ne peut avoir qu’un seul compte machine."
            error={erreurTransporteurs && `Référentiel injoignable : ${erreurTransporteurs}`}
          >
            <select
              className="input-basic"
              value={prestataireId}
              onChange={(e) => {
                if (e.target.value === NOUVEAU) {
                  setPrestataireId('');
                  setSaisieNouveau(true);
                  return;
                }
                setSaisieNouveau(false);
                choisirTransporteur(e.target.value);
              }}
              disabled={!rattachementModifiable}
              required={!saisieNouveau}
            >
              <option value="">
                {options.length === 0
                  ? 'Aucun transporteur disponible'
                  : 'Choisir un transporteur…'}
              </option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
              {/* Le référentiel ne contient pas toujours le transporteur
                  qu'on veut brancher — il se charge en masse (npm run
                  db:reseau) et un nouveau contrat arrive avant le prochain
                  chargement. Sans cette option, il fallait quitter l'écran,
                  créer ailleurs, revenir. */}
              {rattachementModifiable && <option value={NOUVEAU}>+ Nouveau transporteur…</option>}
            </select>

            {saisieNouveau && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <input
                  className="input-basic min-w-0 flex-1"
                  value={nouveauNom}
                  onChange={(e) => setNouveauNom(e.target.value)}
                  placeholder="Nom du transporteur"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => void creerTransporteur()}
                  disabled={creationTransporteur || !nouveauNom.trim()}
                >
                  <Plus size={14} /> Ajouter
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setSaisieNouveau(false);
                    setNouveauNom('');
                  }}
                >
                  Annuler
                </button>
                <span className="w-full text-[11px] text-black/50 dark:text-white/50">
                  Ajouté au référentiel sous son seul nom. Ses agences, ses villes et ses tarifs se
                  saisissent ensuite dans /admin/prestataires.
                </span>
              </div>
            )}

            {options.length === 0 && !saisieNouveau && !erreurTransporteurs && (
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                Tous les transporteurs actifs ont déjà un compte machine — en créer un nouveau
                ci-dessus si besoin.
              </p>
            )}
          </Field>
        )}

        <Field label="Nom" required hint="Affiché ici et comme auteur dans l’historique des colis ingérés.">
          <input
            className="input-basic"
            value={nom}
            onChange={(e) => {
              setNom(e.target.value);
              setNomSaisi(true);
            }}
            required
            autoFocus={edition}
          />
        </Field>

        <Field
          label="Code"
          hint={
            codeModifiable
              ? 'Identifiant stable, utilisé dans les URL et les journaux. Minuscules, chiffres et tirets.'
              : undefined
          }
          error={
            codeModifiable
              ? undefined
              : 'Figé : ce compte a déjà émis une clé ou reçu un appel, et son code est inscrit tel quel dans l’historique des colis. Le nom affiché, lui, reste modifiable.'
          }
        >
          <div className="relative">
            <input
              className="input-basic"
              value={codeModifiable ? code : existant.code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={codePropose || 'shipeh'}
              disabled={!codeModifiable}
            />
            {!codeModifiable && (
              <Lock
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-40"
              />
            )}
          </div>
        </Field>

        {!edition && (
          <p className="text-xs text-black/50 dark:text-white/50">
            Un compte de service est créé en même temps. Il ne peut ouvrir de session sur aucun
            domaine : il n’existe que pour signer les écritures faites au nom de la plateforme.
          </p>
        )}

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={envoi || !nom.trim() || (nature === 'transporteur' && !prestataireId)}
          >
            {edition ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
