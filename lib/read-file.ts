export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// § /livreur/colis, preuve de livraison (RG-02) : une photo prise au
// téléphone pèse plusieurs Mo, or les preuves sont stockées en data URL
// directement dans la colonne (même convention que Commande.cinUrl, pas de
// stockage objet dédié dans ce projet). On redimensionne donc côté client
// avant l'envoi — sans ça chaque livraison gonflerait la ligne commande de
// plusieurs mégaoctets et l'appel PATCH finirait en timeout sur le réseau
// mobile.
export async function readImageAsCompressedDataUrl(file: File, maxSide = 1024, quality = 0.7): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (ratio === 1 && dataUrl.length < 400_000) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * ratio);
  canvas.height = Math.round(image.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
