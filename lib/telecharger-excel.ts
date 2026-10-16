// Côté navigateur : télécharge l'Excel des colis cochés (POST
// /api/commandes/export, format validé du 14/10/2026). Lève une Error au
// message lisible si le serveur refuse.
export async function telechargerExcelColis(colisIds: string[]): Promise<void> {
  const res = await fetch('/api/commandes/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ colisIds }),
  });
  if (!res.ok) {
    const corps = await res.json().catch(() => null);
    throw new Error(corps?.error ?? `Export impossible (${res.status})`);
  }
  const nom = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'colis.xlsx';
  const url = URL.createObjectURL(await res.blob());
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}
