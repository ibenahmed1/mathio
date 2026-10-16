import { ApiError } from '@/lib/api-utils';
import { normaliserCodeColis } from '@/lib/code-colis';
import { remettreTirets } from '@/lib/douchette';
import { validateQrPayload } from '@/lib/parcel-serial';

// Normalise ce qu'un écran de scan envoie vers un codeSuivi canonique
// (`PD-000123`), pour toutes les routes de scan :
// - QR actuel ou saisie : code en clair, `MTH-PD-000123` ou `PD-000123` ;
// - QR des étiquettes imprimées avant le 16/10 : numéro de série signé
//   `AGA-JACHE8-070926.J7` (lib/parcel-serial.ts), toujours accepté.
// Les écrans envoient `qrPayload` quand la lecture contient un point, sinon
// `codeSuivi` : le nouveau QR arrive donc par `codeSuivi`.
export function codeSuiviDepuisScan(qrPayload: string, codeSuiviSaisi: string): string {
  // Mac en AZERTY : la douchette tape « § » pour « - » (lib/douchette.ts).
  const qr = remettreTirets(qrPayload.trim());
  if (qr.includes('.')) {
    const result = validateQrPayload(qr);
    if (!result.valid || result.parcelId === undefined) {
      throw new ApiError(400, result.reason ?? 'QR code invalide');
    }
    return `PD-${String(result.parcelId).padStart(6, '0')}`;
  }
  const codeSuivi = normaliserCodeColis(qr || codeSuiviSaisi);
  if (!codeSuivi) {
    throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
  }
  return codeSuivi;
}
