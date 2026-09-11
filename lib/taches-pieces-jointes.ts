import { prisma } from '@/lib/prisma';
import { libelleFormat, mimeDeDataUrl, typeDeMime, type TypePieceJointe } from '@/lib/pieces-jointes';

// Lecture des pièces jointes d'une tâche pour l'affichage (§ /admin/tasks).
//
// Voir `lib/pieces-jointes.ts` pour la convention de stockage : la colonne
// `url` porte soit un lien externe, soit un fichier entier encodé en base64.

export type PieceJointeExposee = {
  id: string;
  nom: string;
  dateAjout: string;
  auteur: { id: string; nomComplet: string };
  type: TypePieceJointe;
  /** Lien externe tel quel, ou route de contenu pour un fichier déposé. Dans
   *  les deux cas : une adresse qu'on peut poser dans un `href` ou un `src`. */
  url: string;
  mime: string | null;
  /** Poids du fichier décodé, en octets. `null` pour un lien externe. */
  poids: number | null;
  /** Extension ou nom d'hôte, pour l'étiquette de la vignette. */
  format: string;
};

// `$queryRaw` ne passe pas par le mapping Prisma : les colonnes arrivent sous
// leur nom snake_case, et les types sont ceux du driver — d'où les
// conversions explicites plus bas.
type Ligne = {
  id: string;
  nom: string;
  date_ajout: Date | string;
  auteur_id: string;
  auteur_nom: string;
  entete: string;
  octets_encodes: number | string | null;
};

// Requête écrite à la main plutôt qu'en `findMany` pour une seule raison : le
// contenu des fichiers ne doit PAS remonter jusqu'à Node. Dresser la liste ne
// demande que l'en-tête « data:<mime>;base64, », alors qu'un select Prisma
// ramènerait les mégaoctets de chaque pièce à chaque ouverture de fiche — d'où
// le `left(url, 128)`, dont Postgres n'a besoin de détoaster que le début.
// `octet_length` lit la valeur entière, mais côté serveur : c'est le transfert
// qu'on évite, pas la lecture disque.
export async function piecesJointesExposees(tacheId: string): Promise<PieceJointeExposee[]> {
  const lignes = await prisma.$queryRaw<Ligne[]>`
    SELECT
      p.id,
      p.nom,
      p.date_ajout,
      u.id           AS auteur_id,
      u.nom_complet  AS auteur_nom,
      CASE WHEN p.url LIKE 'data:%' THEN left(p.url, 128) ELSE p.url END AS entete,
      CASE WHEN p.url LIKE 'data:%' THEN octet_length(p.url) ELSE NULL END AS octets_encodes
    FROM pieces_jointes_tache p
    JOIN utilisateurs u ON u.id = p.auteur_id
    WHERE p.tache_id = ${tacheId}
    ORDER BY p.date_ajout ASC
  `;

  return lignes.map((ligne) => {
    const mime = mimeDeDataUrl(ligne.entete);
    const type = typeDeMime(mime);
    // Le poids affiché se déduit de la longueur du base64 amputée de son
    // en-tête : à deux octets près (le remplissage final), c'est la taille du
    // fichier. Assez juste pour un libellé, et ça évite de décoder la pièce
    // pour l'écrire.
    const poids =
      mime !== null && ligne.octets_encodes !== null
        ? Math.max(0, Math.floor(((Number(ligne.octets_encodes) - prefixe(ligne.entete)) * 3) / 4))
        : null;
    const url =
      mime === null ? ligne.entete : `/api/taches/${tacheId}/pieces-jointes/${ligne.id}/contenu`;

    return {
      id: ligne.id,
      nom: ligne.nom,
      dateAjout: new Date(ligne.date_ajout).toISOString(),
      auteur: { id: ligne.auteur_id, nomComplet: ligne.auteur_nom },
      type,
      url,
      mime,
      poids,
      format: libelleFormat({ type, mime, url: ligne.entete }),
    };
  });
}

/** Longueur de l'en-tête « data:<mime>;base64, » d'une data URL. */
function prefixe(entete: string): number {
  const separateur = entete.indexOf(',');
  return separateur === -1 ? 0 : separateur + 1;
}
