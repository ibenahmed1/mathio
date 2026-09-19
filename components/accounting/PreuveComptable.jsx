"use client";

import { useState } from "react";
import { Download, ImagePlus, Loader2, X } from "lucide-react";
import { Modal } from "@/components/admin/Modal";
import { readFileAsDataUrl, readImageAsCompressedDataUrl } from "@/lib/read-file";
import { libelleTaille } from "@/lib/pieces-jointes";
import { ACCEPT_PREUVE_COMPTABLE, analyserPreuveComptable, dataUrlPreuve } from "@/lib/finance";

// Justificatif photo d'une pièce comptable, côté écran — partagé par les DEUX
// cartes de /admin/comptabilite : les écritures du journal (TransactionsTable)
// et les commandes d'inventaire (InventoryOrders). Le geste est le même, la
// validation est la même (§ lib/finance.ts), et le tenir en un seul endroit
// évite que les deux formulaires se mettent à accepter des choses différentes.
//
// Trois briques :
//   usePreuveComptable() — l'état et la lecture du fichier,
//   <ChampPreuve>        — la zone de dépôt du formulaire,
//   <ModalePreuve>       — la visionneuse d'une pièce déjà enregistrée.

const PREUVE_VIDE = { dataUrl: null, poids: 0 };

// § « supporte tout type d'image ». La compression passe par un <canvas>, qui ne
// sait décoder que les formats connus DU NAVIGATEUR : un HEIC d'iPhone ouvert
// dans Chrome y échoue. On retombe alors sur le fichier brut, et c'est la liste
// blanche de lib/finance.ts qui tranche — plutôt qu'un refus sec devant une
// photo parfaitement valide sur la machine qui l'a prise.
//
// 1600 px et qualité 0,75 là où une preuve de livraison se contente de 1024 et
// 0,7 : sur un reçu, ce qu'on vient vérifier est un montant écrit petit, et une
// compression trop forte le rend illisible — le justificatif ne justifie plus
// rien.
async function lireImage(file) {
  try {
    return await readImageAsCompressedDataUrl(file, 1600, 0.75);
  } catch {
    return await readFileAsDataUrl(file);
  }
}

export function usePreuveComptable() {
  const [preuve, setPreuve] = useState(PREUVE_VIDE);
  const [erreur, setErreur] = useState(null);
  const [lecture, setLecture] = useState(false);

  // Le fichier est lu, éventuellement recompressé, puis passé à la MÊME analyse
  // que celle du serveur : un format ou un poids refusé se dit ici, avec le même
  // message, avant d'avoir téléversé quoi que ce soit.
  async function choisir(e) {
    const file = e.target.files?.[0];
    // On vide l'input tout de suite : sans ça, retirer la photo puis
    // resélectionner LE MÊME fichier ne déclenche aucun événement (la valeur de
    // l'input n'a pas changé) et le champ paraît cassé.
    e.target.value = "";
    if (!file) return;

    setErreur(null);
    setLecture(true);
    try {
      const analyse = analyserPreuveComptable(await lireImage(file));
      if (analyse.statut === "refus") {
        setErreur(analyse.message);
        return;
      }
      setPreuve({ dataUrl: dataUrlPreuve(analyse.preuve), poids: analyse.preuve.poids });
    } catch {
      setErreur("Image illisible. Réessayez, ou choisissez un autre fichier.");
    } finally {
      setLecture(false);
    }
  }

  function retirer() {
    setPreuve(PREUVE_VIDE);
    setErreur(null);
  }

  return {
    preuve,
    erreur,
    lecture,
    choisir,
    retirer,
    /** Remise à zéro après un envoi réussi : sans elle, la photo resterait
     *  accrochée à la pièce suivante. */
    reinitialiser: retirer,
    /** Ce qu'il faut poser dans le corps du POST. `undefined` et non `null`
     *  quand il n'y a pas de photo : on n'envoie alors rien du tout. */
    corps: preuve.dataUrl || undefined,
  };
}

/** Zone de dépôt du formulaire. `etat` est l'objet rendu par
 *  usePreuveComptable(). `libelle` nomme la pièce attendue selon la carte — un
 *  reçu de dépense et une facture de fournisseur ne se cherchent pas dans les
 *  mêmes papiers. */
export function ChampPreuve({ etat, libelle = "Justificatif", invite = "Photographier ou déposer le reçu" }) {
  const { preuve, erreur, lecture, choisir, retirer } = etat;

  return (
    // Un `div.form-field` et non un `<Field>` : ce dernier rend un <label>, et
    // le déclencheur du sélecteur de fichier en est un aussi. Deux <label>
    // imbriqués ne cliquent plus de façon fiable (c'est déjà la raison du même
    // choix sur la photo produit, § /marchand/inventaire/nouveau).
    <div className="form-field sm:col-span-2">
      <span className="form-label">
        {libelle}
        <span className="form-optional">Optionnel</span>
      </span>

      {preuve.dataUrl ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {/* Aperçu local : la photo n'est pas encore en base, donc pas de route
              de contenu à interroger. `object-contain` et non `cover` — sur un
              reçu, rogner les bords enlève justement le total. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preuve.dataUrl}
            alt="Aperçu du justificatif"
            className="max-h-52 w-full rounded-xl border border-black/10 bg-black/[0.03] object-contain sm:max-w-[16rem] dark:border-white/10 dark:bg-white/[0.04]"
          />
          <div className="flex flex-col items-start gap-2">
            <p className="form-hint">Image jointe · {libelleTaille(preuve.poids)}</p>
            <div className="flex flex-wrap gap-2">
              <label className="btn-outline btn-sm cursor-pointer">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                Remplacer
                <input type="file" accept={ACCEPT_PREUVE_COMPTABLE} className="hidden" onChange={choisir} />
              </label>
              <button type="button" className="btn-ghost btn-sm" onClick={retirer}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Retirer
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Hauteur en `min-h` et non fixe : la zone doit pouvoir grandir avec le
        // texte quand la fenêtre est étroite, sans que le libellé passe sous le
        // bord.
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-black/15 px-4 py-5 text-center transition hover:border-brand hover:bg-brand/5 dark:border-white/15">
          {lecture ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin opacity-40" aria-hidden />
              <span className="text-sm opacity-60">Lecture de l&apos;image…</span>
            </>
          ) : (
            <>
              <ImagePlus className="h-6 w-6 opacity-40" aria-hidden />
              <span className="text-sm font-semibold">{invite}</span>
              <span className="form-hint">
                JPEG, PNG, WebP, AVIF, HEIC, GIF, BMP, TIFF — redimensionné automatiquement
              </span>
            </>
          )}
          <input
            type="file"
            accept={ACCEPT_PREUVE_COMPTABLE}
            className="hidden"
            onChange={choisir}
            disabled={lecture}
          />
        </label>
      )}

      {/* L'erreur du justificatif s'affiche ICI et pas avec celle du formulaire :
          un format refusé ne dit rien du montant ni de la date, et la pièce peut
          être enregistrée sans photo. */}
      {erreur && <p className="form-error">{erreur}</p>}
    </div>
  );
}

/** Visionneuse d'un justificatif DÉJÀ enregistré. `url` est le pointeur exposé
 *  par l'API (route de contenu), jamais une data URL : c'est tout l'intérêt du
 *  `omit` côté serveur. */
export function ModalePreuve({ titre = "Justificatif", legende, url, onClose }) {
  return (
    <Modal title={titre} size="lg" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {legende && <p className="form-hint">{legende}</p>}
        {/* <img> nue : la route de contenu sert des octets déjà stockés,
            next/image n'aurait rien à optimiser. `max-h` en dvh pour que l'image
            ne pousse jamais les actions hors de la fenêtre sur un téléphone,
            barre d'adresse dépliée ou non. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={legende ? `Justificatif — ${legende}` : "Justificatif"}
          className="max-h-[60dvh] w-full rounded-xl border border-black/10 bg-black/[0.03] object-contain dark:border-white/10 dark:bg-white/[0.04]"
        />
        <div className="form-actions">
          {/* Deux sorties, et elles ne font pas la même chose : ouvrir permet de
              zoomer sur un montant écrit petit, télécharger d'agrafer la pièce à
              un dossier comptable. */}
          <a href={url} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
            Ouvrir en plein écran
          </a>
          <a href={url} download className="btn-primary btn-sm">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Télécharger
          </a>
        </div>
      </div>
    </Modal>
  );
}
