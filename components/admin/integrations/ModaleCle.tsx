'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import type { CleApi, EnvironnementApi, PlateformeDetail } from '@/lib/types';
import { scopeInterdit, scopesDeLaNature } from '@/components/admin/integrations/scopes';

export function ModaleCle({
  plateforme,
  onClose,
  onCreee,
}: {
  plateforme: PlateformeDetail;
  onClose: () => void;
  onCreee: (cleComplete: string) => void;
}) {
  // La nature du compte décide des deux valeurs par défaut. Un transporteur ne
  // dépose rien, il déclare — et son unique scope étant refusé en `test`, lui
  // proposer une clé de bac à sable serait lui proposer une clé sans aucun
  // pouvoir, donc un formulaire qui ne peut pas aboutir.
  const estTransporteur = plateforme.prestataire !== null;
  const [environnement, setEnvironnement] = useState<EnvironnementApi>(
    estTransporteur ? 'live' : 'test'
  );
  const [scopes, setScopes] = useState<string[]>(
    estTransporteur ? ['livraisons:statut'] : ['colis:creation']
  );
  const [libelle, setLibelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const scopesDuCompte = scopesDeLaNature(estTransporteur);

  function basculer(scope: string) {
    setScopes((courants) =>
      courants.includes(scope) ? courants.filter((s) => s !== scope) : [...courants, scope]
    );
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await apiPost<{ cleComplete: string; cle: CleApi }>(
        `/api/plateformes/${plateforme.id}/cles`,
        {
          environnement,
          scopes: scopes.filter((s) => !scopeInterdit(s, environnement)),
          libelle: libelle.trim() || null,
        }
      );
      onCreee(reponse.cleComplete);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Émission impossible');
    } finally {
      setEnvoi(false);
    }
  }

  const retenus = scopes.filter((s) => !scopeInterdit(s, environnement));

  return (
    <Modal title={`Émettre une clé — ${plateforme.nom}`} onClose={onClose}>
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <Field label="Environnement" required>
          <div className="btn-row">
            {(['test', 'live'] as EnvironnementApi[]).map((env) => (
              <button
                key={env}
                type="button"
                className={environnement === env ? 'btn-dark btn-sm' : 'btn-outline btn-sm'}
                onClick={() => setEnvironnement(env)}
              >
                {env}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Périmètre" required hint="Une clé ne peut faire que ce qui est coché ici.">
          <div className="flex flex-col gap-2">
            {scopesDuCompte.map((s) => {
              // Les scopes de l'AUTRE nature sont ABSENTS (scopesDeLaNature) ;
              // ceux-ci sont GRISÉS, et la distinction est voulue : celui-là
              // redevient cochable en passant la clé en `live`, et c'est
              // précisément le geste qu'on veut rendre visible.
              const interdit = scopeInterdit(s.cle, environnement);
              return (
                <label key={s.cle} className={`check-row items-start ${interdit ? 'opacity-40' : ''}`}>
                  <input
                    type="checkbox"
                    className="check-box mt-0.5"
                    checked={!interdit && scopes.includes(s.cle)}
                    disabled={interdit}
                    onChange={() => basculer(s.cle)}
                  />
                  <span>
                    {s.libelle}
                    <span className="ml-1 font-mono text-[11px] text-black/40 dark:text-white/40">
                      {s.cle}
                    </span>
                    {s.avertissement && (
                      <span className="block text-[11px] font-normal text-black/45 dark:text-white/45">
                        {s.avertissement}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Libellé" optional hint="Pour vous repérer entre deux clés pendant une rotation.">
          <input
            className="input-basic"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Production — rotation septembre"
          />
        </Field>

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi || retenus.length === 0}>
            <KeyRound size={15} /> Émettre
          </button>
        </div>
      </form>
    </Modal>
  );
}
