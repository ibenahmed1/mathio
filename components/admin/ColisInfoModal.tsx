'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, X } from 'lucide-react';
import type { Commande } from '@/lib/types';
import { LABELS_STATUT_COMMANDE, LABELS_ETAT_PAIEMENT } from '@/lib/statuts';

const BADGE_DANGER = new Set(['refuse', 'retourne', 'en_retour_par_amana', 'annule', 'annule_par_vendeur', 'hors_zone']);
const BADGE_WARN = new Set([
  'boite_vocale',
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'pas_de_reponse_sms',
  'injoignable',
  'numero_errone',
  'client_interesse',
  'relance_nouveau_client',
  'attente_de_relancer',
  'programme',
  'reporte',
]);

function badgeClass(statut: string): string {
  if (statut === 'livre') return 'mtBadge';
  if (BADGE_DANGER.has(statut)) return 'mtBadge mtBadge--danger';
  if (BADGE_WARN.has(statut)) return 'mtBadge mtBadge--warn';
  return 'mtBadge mtBadge--neutral';
}

export function ColisInfoModal({
  commande,
  onClose,
  onTrack,
}: {
  commande: Commande;
  onClose: () => void;
  onTrack?: () => void;
}) {
  const [closing, setClosing] = useState(false);

  function close() {
    setClosing(true);
    setTimeout(onClose, 220);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Floute/fige le dashboard (.mtContent, cf. AdminShell) et bloque son
  // scroll tant que le modal est monté — retiré uniquement au démontage,
  // donc après les 220ms de l'animation de fermeture.
  useEffect(() => {
    document.body.classList.add('mtModalOpen');
    return () => document.body.classList.remove('mtModalOpen');
  }, []);

  const produitNom = commande.produit?.nom ?? commande.marchandise?.nom ?? commande.produitDescription ?? 'Produit non précisé';
  const produitDetail = commande.produit
    ? `Réf. stock : ${commande.produit.reference}`
    : commande.marchandise
      ? `Prix unitaire : ${commande.marchandise.prix} DH`
      : commande.enStock
        ? 'Marchandise en stock'
        : '—';

  // Photo via la relation Commande.produit (résolue par SKU à l'import
  // stock, cf. app/api/commandes/import) — pas de matching par texte, et
  // pas d'image pour un colis normal (produit reste null).
  const photoUrl = commande.produit?.photoUrl ?? null;

  const options = [
    commande.ouvrir && 'Ouvrir',
    commande.fragile && 'Fragile',
    commande.aRemplacer && 'Échange',
    commande.enStock && 'Stock',
  ].filter(Boolean) as string[];

  // Monté directement sous <body> (hors de .mtContent et de tout ancêtre
  // de la page) : un ancêtre avec filter/transform/backdrop-filter créerait
  // un containing block qui casse à la fois position:fixed et le
  // backdrop-filter du modal lui-même.
  return createPortal(
    <div
      className={`mtOverlay ${closing ? 'mtClosing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mtTitle"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="mtModal">
        <div className="mtHead">
          <div className="mtIcon">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <div className="mtEyebrow">INFORMATION DU COLIS</div>
            <div className="mtTitleRow">
              <div className="mtTitle" id="mtTitle">
                {commande.codeSuivi}
              </div>
              <span className={badgeClass(commande.statut)}>{LABELS_STATUT_COMMANDE[commande.statut]}</span>
            </div>
          </div>
          <div className="mtCrbt">
            <div>
              <div className="mtCrbtLabel">CRBT</div>
              <div className="mtCrbtValue">{commande.montantCod} DH</div>
            </div>
            <button className="mtClose" type="button" aria-label="Fermer" onClick={close}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mtGrid">
          <div className="mtCard">
            <div className="mtCardHead">
              <span className="mtDot" />
              EXPÉDITEUR
            </div>
            <div className="mtRow">
              <span className="mtLabel">Magasin</span>
              <span className="mtValue">{commande.marchand?.nomBoutique ?? '—'}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Livreur</span>
              <span className="mtValue">{commande.livreur?.nomComplet ?? '— non assigné —'}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Ramasseur</span>
              <span className="mtValue">{commande.ramassage?.ramasseur?.nomComplet ?? '—'}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Paiement</span>
              <span className="mtValue">{LABELS_ETAT_PAIEMENT[commande.etatPaiement]}</span>
            </div>
          </div>

          <div className="mtCard">
            <div className="mtCardHead">
              <span className="mtDot dark" />
              DESTINATAIRE
              {commande.aRemplacer && commande.colisARemplacer && (
                <span className="mtChip">{commande.colisARemplacer.codeSuivi}</span>
              )}
            </div>
            <div className="mtRow">
              <span className="mtLabel">Nom</span>
              <span className="mtValue">{commande.clientNom}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Téléphone</span>
              <span className="mtValue">{commande.clientTelephone}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Ville</span>
              <span className="mtValue">{commande.ville}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Adresse</span>
              <span className="mtValue">{commande.adresse}</span>
            </div>
            <div className="mtRow">
              <span className="mtLabel">Options</span>
              <span className="mtValue">{options.length > 0 ? options.join(' · ') : '—'}</span>
            </div>
          </div>
        </div>

        <div className="mtTableWrap">
          <div className="mtTable">
            <div className="mtTHead">
              <span>PHOTO</span>
              <span>PRODUIT</span>
              <span>QUANTITÉ</span>
            </div>
            <div className="mtTRow">
              <div className={photoUrl ? 'mtPhoto mtPhoto--img' : 'mtPhoto mtPhoto--empty'}>
                {photoUrl && <img src={photoUrl} alt={produitNom} />}
              </div>
              <div>
                <div className="mtProduct">{produitNom}</div>
                <div className="mtVariant">{produitDetail}</div>
              </div>
              <div className="mtQty">
                ×{commande.quantite} <span className="mtPrice">{commande.montantCod} DH</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mtFoot">
          <div className="mtNote">
            Commentaire : <b>{commande.notes ?? '—'}</b>
          </div>
          <div className="mtActions">
            <button
              className="mtBtn mtBtnGhost"
              type="button"
              onClick={() => window.open(`/admin/colis/${commande.id}/ticket`, '_blank')}
            >
              Imprimer
            </button>
            {onTrack && (
              <button className="mtBtn mtBtnPrimary" type="button" onClick={onTrack}>
                Suivre le colis
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
