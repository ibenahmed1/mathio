import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import { buildQrPayload, generateParcelSerial, resolveVilleCode } from "@/lib/parcel-serial";

/**
 * Relie le moteur générique de `parcel-serial.ts` aux données réelles d'une
 * `Commande` : en extrait l'ID séquentiel depuis `codeSuivi` (pas de colonne
 * dédiée nécessaire), génère le numéro de série + son QR code. Rien n'est
 * persisté : le numéro de série est recalculé à chaque impression à partir
 * de champs déjà en base (`codeSuivi`, `ville`, date de création).
 */

const CODE_SUIVI_PATTERN = /^PD-(\d+)$/;

function parcelIdFromCodeSuivi(codeSuivi: string): number {
  const match = CODE_SUIVI_PATTERN.exec(codeSuivi);
  if (!match) {
    throw new Error(`codeSuivi inattendu, format "PD-000000" requis : "${codeSuivi}".`);
  }
  return parseInt(match[1], 10);
}

export interface ParcelLabel {
  serial: string;
  qrPayload: string;
  /** Markup `<svg>...</svg>` autonome, prêt à être injecté (dangerouslySetInnerHTML). */
  qrSvg: string;
  /** Code-barres Code128 du `codeSuivi` (identifiant interne) — même remarque
   * sur l'injection : markup généré par nos soins, jamais depuis une entrée
   * utilisateur. */
  barcodeSvg: string;
}

/** Code128 du `codeSuivi` : c'est l'identifiant déjà utilisé partout dans
 * l'app (recherche, rapprochement de colis) — le code-barres sert au scan
 * rapide en entrepôt. Le QR, lui, porte le numéro de série signé (HMAC),
 * pour la vérification anti-falsification. */
function buildBarcodeSvg(codeSuivi: string): string {
  return bwipjs.toSVG({
    bcid: "code128",
    text: codeSuivi,
    scale: 2,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
}

export async function buildParcelLabel(params: {
  codeSuivi: string;
  ville: string;
  date: Date;
}): Promise<ParcelLabel> {
  const cityCode = resolveVilleCode(params.ville);
  const parcelId = parcelIdFromCodeSuivi(params.codeSuivi);
  const serial = generateParcelSerial(cityCode, parcelId, params.date);
  const qrPayload = buildQrPayload(serial);
  const qrSvg = await QRCode.toString(qrPayload, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
  });
  const barcodeSvg = buildBarcodeSvg(params.codeSuivi);

  return { serial, qrPayload, qrSvg, barcodeSvg };
}

/** Génère les étiquettes de plusieurs colis en parallèle (toujours O(1) par
 * colis : pas de requête DB additionnelle).
 *
 * Tolérant à la ligne près : un colis dont l'étiquette ne peut pas être
 * construite (codeSuivi hors format "PD-000000", par ex. un import
 * partenaire) est simplement absent de la Map — les vues d'impression
 * traitent déjà `labels.get(codeSuivi)` comme optionnel. Un seul colis
 * douteux ne doit pas faire échouer l'impression de tout un bon. */
export async function buildParcelLabels(
  commandes: Array<{ codeSuivi: string; ville: string; dateCreation: Date }>
): Promise<Map<string, ParcelLabel>> {
  const entries = await Promise.all(
    commandes.map(async (c) => {
      try {
        const label = await buildParcelLabel({
          codeSuivi: c.codeSuivi,
          ville: c.ville,
          date: c.dateCreation,
        });
        return [c.codeSuivi, label] as const;
      } catch (error) {
        console.error(`[parcel-label] Étiquette non générée pour "${c.codeSuivi}" :`, error);
        return null;
      }
    })
  );
  return new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}
