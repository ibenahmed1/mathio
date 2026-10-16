import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import { codeEtiquette } from "@/lib/code-colis";

/**
 * Étiquette d'un colis : QR + code-barres, recalculés à chaque impression à
 * partir du `codeSuivi` (rien n'est persisté).
 *
 * Depuis le 16/10, le QR porte le code `MTH-PD-000123` (lib/code-colis.ts) :
 * celui qu'on transmet aux transporteurs, pour que leur scanner retrouve le
 * colis comme le nôtre. Il remplace le numéro de série signé
 * `AGA-JACHE8-070926.J7`, inconnu des transporteurs ; nos écrans de scan
 * acceptent toujours ce dernier sur les étiquettes déjà imprimées
 * (lib/scan-colis.ts).
 */

export interface ParcelLabel {
  /** Contenu du QR, imprimé aussi en clair sous le QR. */
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
 * rapide en entrepôt. */
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

export async function buildParcelLabel(params: { codeSuivi: string }): Promise<ParcelLabel> {
  const qrPayload = codeEtiquette(params.codeSuivi);
  const qrSvg = await QRCode.toString(qrPayload, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
  });
  const barcodeSvg = buildBarcodeSvg(params.codeSuivi);

  return { qrPayload, qrSvg, barcodeSvg };
}

/** Génère les étiquettes de plusieurs colis en parallèle (pas de requête DB).
 *
 * Tolérant à la ligne près : un colis dont l'étiquette ne peut pas être
 * construite est simplement absent de la Map — les vues d'impression
 * traitent déjà `labels.get(codeSuivi)` comme optionnel. Un seul colis
 * douteux ne doit pas faire échouer l'impression de tout un bon. */
export async function buildParcelLabels(
  commandes: Array<{ codeSuivi: string }>
): Promise<Map<string, ParcelLabel>> {
  const entries = await Promise.all(
    commandes.map(async (c) => {
      try {
        const label = await buildParcelLabel({ codeSuivi: c.codeSuivi });
        return [c.codeSuivi, label] as const;
      } catch (error) {
        console.error(`[parcel-label] Étiquette non générée pour "${c.codeSuivi}" :`, error);
        return null;
      }
    })
  );
  return new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}
