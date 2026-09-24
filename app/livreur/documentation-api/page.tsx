import { ExternalLink } from 'lucide-react';
import { BlocCode } from './BlocCode';
import { CATALOGUE_STATUTS_PRESTATAIRE, type StatutPrestataire } from '@/lib/statuts';
import { NOTE_MAX, TAILLE_MAX_LOT_STATUTS } from '@/lib/livraison-statut';
import { HOST_API } from '@/lib/spaces';
import s from './DocumentationApi.module.css';

// § /livreur/documentation-api — la documentation de l'API de suivi des
// livraisons (§ API_SUIVI_PRESTATAIRES.md), celle que reçoivent les
// transporteurs sous-traitants.
//
// Elle est CODÉE ici, dans le style EXACT du document déployé
// (public/MpLLAwOb3Nkr2xXW.html, dont la feuille de style est portée en module
// CSS à côté de ce fichier), et non affichée dans une iframe. Deux raisons, et
// la seconde est la vraie :
//   — une page intégrée se navigue, se cherche et s'imprime avec le reste de
//     l'application, ce qu'un cadre isolé ne permet pas ;
//   — surtout, elle peut tirer ses chiffres du code plutôt que d'une copie
//     figée. Trois choses ne peuvent donc plus se désaligner du service réel :
//       · les statuts, lus dans CATALOGUE_STATUTS_PRESTATAIRE, qui est
//         exactement ce que sert GET /api/v1/statuts ;
//       · les deux plafonds (taille de lot, longueur de note), lus dans
//         lib/livraison-statut.ts, qui est ce qui les applique ;
//       · l'adresse de l'API, lue dans la configuration du déploiement.
//
// Le reste — formulations, exemples, codes d'erreur — suit la page publique mot
// pour mot : les deux documents doivent dire la même chose, et c'est celui du
// partenaire qui fait foi. Le lien vers cette page publique est gardé en tête
// d'écran pour pouvoir vérifier l'un par l'autre.
//
// Seul le bloc de code est un composant client (bouton « Copier ») ; tout le
// reste est rendu au serveur, rien ici n'a d'état.

const URL_PAGE_PUBLIQUE = '/MpLLAwOb3Nkr2xXW.html';

// Numéro donné en pied de la page publique, pour demander une clé ou signaler
// un incident. Redit ici plutôt que déduit : la page publique le porte en
// clair, les deux doivent afficher le même.
const CONTACT = '06 30 19 13 74';

// Origine de l'API machine. `HOST_API` n'est pas toujours configurée — un
// déploiement qui n'ouvre aucune intégration partenaire ne la pose pas, et
// toute la surface /api/v1/** reste alors injoignable (§ lib/spaces.ts). Dans
// ce cas l'écran le dit, au lieu d'afficher une adresse qui ne répondrait pas —
// c'est le pendant du bandeau « URL de l'API non configurée » de la page
// déployée, qui se garde de la même façon d'être envoyée en l'état.
const apiConfiguree = Boolean(HOST_API);
const ORIGINE_API = HOST_API
  ? `${HOST_API.includes('localhost') || HOST_API.startsWith('127.') ? 'http' : 'https'}://${HOST_API}`
  : 'https://api.mathio.ma';
const BASE_API = `${ORIGINE_API}/api/v1`;

// Découpage des statuts en familles, tel que le présente la page publique. Les
// deux premières familles sont DÉDUITES du catalogue (`terminal`,
// `dateRequise`) : elles ne peuvent pas mentir. La dernière ne l'est pas — rien
// dans le catalogue ne distingue un échec de livraison d'un échec de contact —
// elle est donc énumérée ici, et ce qui n'y figure pas retombe dans les échecs
// de livraison. Un statut ajouté au catalogue apparaîtra donc toujours, au pire
// dans la mauvaise des deux dernières familles, jamais nulle part.
const STATUTS_CONTACT = [
  'injoignable',
  'boite_vocale',
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'client_interesse',
];

const familleTerminaux = CATALOGUE_STATUTS_PRESTATAIRE.filter((s) => s.terminal);
const familleDatees = CATALOGUE_STATUTS_PRESTATAIRE.filter((s) => !s.terminal && s.dateRequise);
const familleContact = CATALOGUE_STATUTS_PRESTATAIRE.filter(
  (s) => !s.terminal && !s.dateRequise && STATUTS_CONTACT.includes(s.statut)
);
const familleEchecs = CATALOGUE_STATUTS_PRESTATAIRE.filter(
  (s) => !s.terminal && !s.dateRequise && !STATUTS_CONTACT.includes(s.statut)
);

// Vocabulaire courant des outils de livraison du marché, pour l'intégrateur qui
// a déjà branché un confrère (§ le commentaire de STATUTS_PRESTATAIRE dans
// lib/statuts.ts, qui explique pourquoi l'enum se projette terme à terme).
const CORRESPONDANCES: [string, string][] = [
  ['DELIVERED', 'livre'],
  ['POSTPONED', 'reporte'],
  ['PROGRAMMED', 'programme'],
  ['NOANSWER', 'injoignable'],
  ['UNREACHABLE', 'hors_zone'],
  ['REFUSE', 'refuse'],
  ['CANCELLED', 'annule'],
  ['INTERESTED', 'client_interesse'],
  ['DEUXIEME', 'deuxieme_appel_pas_reponse'],
  ['TROISIEME', 'troisieme_appel_pas_reponse'],
];

// Codes d'erreur, tels que les posent lib/livraison-statut.ts,
// lib/plateforme-auth.ts et les routes /api/v1/**. Énumérés ici : ils sont
// levés à travers plusieurs modules, aucun ne tient la liste complète.
const ERREURS: { http: number; codes: string[]; sens: React.ReactNode }[] = [
  {
    http: 400,
    codes: ['json_invalide', 'corps_invalide'],
    sens: "Le corps n'est pas un JSON valide, ou pas un objet.",
  },
  {
    http: 400,
    codes: ['champ_requis'],
    sens: (
      <>
        <code>codeSuivi</code> absent, ou lot vide.
      </>
    ),
  },
  { http: 400, codes: ['statut_invalide'], sens: 'Valeur hors catalogue. Le message liste les valeurs acceptées.' },
  {
    http: 400,
    codes: ['date_requise'],
    sens: (
      <>
        Date absente, ou pas au format ISO 8601, pour <code>reporte</code> ou <code>programme</code>.
      </>
    ),
  },
  {
    http: 400,
    codes: ['note_trop_longue', 'lot_trop_grand'],
    sens: `Note au-delà de ${NOTE_MAX} caractères, ou lot au-delà de ${TAILLE_MAX_LOT_STATUTS} lignes.`,
  },
  { http: 401, codes: ['cle_absente', 'cle_invalide'], sens: "En-tête d'authentification manquant, ou clé incorrecte." },
  {
    http: 401,
    codes: ['cle_expiree', 'cle_revoquee'],
    sens: "Votre clé n'est plus valide. Contactez-nous pour en recevoir une nouvelle.",
  },
  {
    http: 403,
    codes: ['scope_manquant', 'compte_sans_prestataire', 'plateforme_desactivee'],
    sens: "Votre accès n'est pas ouvert à cet usage. Contactez-nous.",
  },
  {
    http: 404,
    codes: ['colis_introuvable'],
    sens: "Ce code ne correspond à aucun colis que vous pouvez déclarer — soit le code est erroné, soit sa ville de destination n'est pas dans votre zone.",
  },
  { http: 409, codes: ['colis_clos'], sens: 'Le colis est déjà clôturé. Aucun autre statut ne peut être posé.' },
  { http: 409, codes: ['conflit_concurrent'], sens: 'Le colis a changé de statut pendant votre requête. Réessayez.' },
  { http: 429, codes: ['quota_depasse'], sens: 'Trop de requêtes. Le message indique le délai avant de réessayer.' },
  {
    http: 500,
    codes: ['erreur_interne'],
    sens: "Incident de notre côté. Contactez-nous en précisant l'heure de l'appel.",
  },
];

function GroupeStatuts({
  titre,
  marque,
  aide,
  statuts,
  clos,
}: {
  titre: string;
  marque?: string;
  aide: string;
  statuts: StatutPrestataire[];
  clos?: boolean;
}) {
  return (
    <div className={`${s.group} ${clos ? s.groupClose : ''}`}>
      <h3 className={s.h3}>
        {titre}
        {marque && <span>{marque}</span>}
      </h3>
      <p className={s.groupAide}>{aide}</p>
      <ul className={s.st}>
        {statuts.map((statut) => (
          <li key={statut.statut}>
            <code>{statut.statut}</code>
            <span>{statut.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DocumentationApiLivreurPage() {
  return (
    <div className={s.doc}>
      <div className={s.wrap}>
        <div className={s.barre}>
          <a href={URL_PAGE_PUBLIQUE} target="_blank" rel="noreferrer" className={s.lienPublic}>
            <ExternalLink size={13} />
            Voir la page publique
          </a>
        </div>

        {!apiConfiguree && (
          <p className={s.alerte}>
            API partenaires non configurée sur ce déploiement (variable HOST_API) — l&apos;adresse ci-dessous est
            celle de la production, elle ne répondra pas ici.
          </p>
        )}

        {/* ---------- Héros ---------- */}
        <div className={s.hero}>
          <div>
            <p className={s.pill}>
              <i />
              Pour nos partenaires de livraison
            </p>
            <h1 className={s.titre}>
              Déclarez l&apos;issue de chaque colis, <mark>en une requête.</mark>
            </h1>
            <p className={s.lede}>
              Vous livrez les colis que nous vous confions. Cette API vous permet de nous dire, au fil de vos
              tournées, ce qu&apos;ils deviennent : livré, reporté, refusé, injoignable.
            </p>
          </div>

          <div className={s.demo} aria-label="Exemple de requête et de réponse">
            <div className={s.demoTape} aria-hidden="true" />
            <div className={s.demoHead}>
              <b>POST</b> /api/v1/livraisons/statut
            </div>
            {/* L'alignement de ces deux blocs est celui du document déployé,
                à la colonne près. Chaque fragment de texte est donc écrit en
                expression : JSX rogne les espaces de début et de fin de ligne,
                et « Content-Type:  application/json » aurait perdu un de ses
                deux espaces en chemin. */}
            <pre>
              <span className={s.d}>{'Authorization:'}</span>
              {' Bearer mtk_live_••••••••\n'}
              <span className={s.d}>{'Content-Type:'}</span>
              {'  application/json\n\n'}
              {'{\n  '}
              <span className={s.k}>{'"codeSuivi"'}</span>
              {': "PD-000123",\n  '}
              <span className={s.k}>{'"statut"'}</span>
              {':    "reporte",\n  '}
              <span className={s.k}>{'"date"'}</span>
              {':      "2026-09-15",\n  '}
              <span className={s.k}>{'"note"'}</span>
              {':      "Client absent, repasse mardi"\n}'}
            </pre>
            <div className={s.demoSep} />
            <div className={s.demoHead}>
              <span className={s.okTexte}>200 OK</span>
            </div>
            <pre>
              {'{\n  '}
              <span className={s.k}>{'"issue"'}</span>
              {':     "applique",\n  '}
              <span className={s.k}>{'"codeSuivi"'}</span>
              {': "PD-000123",\n  '}
              <span className={s.k}>{'"statut"'}</span>
              {':    "reporte"\n}'}
            </pre>
          </div>
        </div>

        {/* ---------- Démarrer ---------- */}
        <section className={s.section}>
          <p className={s.eyebrow}>Démarrer</p>
          <h2 className={s.h2}>Trois étapes jusqu&apos;à votre première déclaration</h2>
          <p className={s.intro}>
            Vous pouvez développer toute l&apos;intégration avant de recevoir votre clé : les formats, les statuts
            et les erreurs sont décrits intégralement ci-dessous.
          </p>

          <div className={s.steps}>
            <div className={s.step}>
              <h3 className={s.h3}>Recevoir votre clé</h3>
              <p>
                Nous vous la transmettons <strong>en privé</strong>, personnellement. Elle commence par{' '}
                <code>mtk_live_</code> et n&apos;est communiquée qu&apos;une seule fois : conservez-la dans un
                gestionnaire de secrets.
              </p>
            </div>
            <div className={s.step}>
              <h3 className={s.h3}>Vérifier le branchement</h3>
              <p>
                Appelez <code>POST /api/v1/auth</code>. Une réponse <code>200</code> confirme que la clé est valide
                et ouverte au suivi des livraisons. Cet appel ne modifie aucun colis.
              </p>
            </div>
            <div className={s.step}>
              <h3 className={s.h3}>Déclarer vos statuts</h3>
              <p>
                À chaque événement de tournée, ou en lot en fin de journée, envoyez le statut de chaque colis avec
                son code de suivi.
              </p>
            </div>
          </div>

          <h3 className={s.sousTitre}>Adresse de l&apos;API</h3>
          <BlocCode>{BASE_API}</BlocCode>

          <h3 className={s.sousTitre}>En-têtes</h3>
          <div className={s.tw}>
            <table className={s.kv}>
              <thead>
                <tr>
                  <th>En-tête</th>
                  <th>Valeur</th>
                  <th>Quand</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Authorization</td>
                  <td>
                    <code>Bearer &lt;votre clé&gt;</code>
                  </td>
                  <td>toujours</td>
                </tr>
                <tr>
                  <td>Content-Type</td>
                  <td>
                    <code>application/json</code>
                  </td>
                  <td>requêtes avec un corps</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--ink-soft)', maxWidth: '62ch' }}>
            Si votre outil ne permet pas de poser <code>Authorization</code>, l&apos;en-tête{' '}
            <code>X-Mathio-Api-Key: &lt;votre clé&gt;</code> est accepté à la place.
          </p>
        </section>

        {/* ---------- Endpoints ---------- */}
        <section className={s.section}>
          <p className={s.eyebrow}>Référence</p>
          <h2 className={s.h2}>Quatre endpoints, c&apos;est tout</h2>
          <p className={s.intro}>
            Toutes les réponses sont en JSON. Les champs sont en français, comme les valeurs de statut.
          </p>

          <div className={s.ep}>
            <div className={s.epTop}>
              <span className={`${s.verb} ${s.verbPost}`}>POST</span>
              <span className={s.path}>/api/v1/auth</span>
              <span className={s.epWhen}>une fois, au branchement</span>
            </div>
            <div className={s.epBody}>
              <div>
                <h4 className={s.h4}>Rôle</h4>
                <p>Vérifier que votre clé est valide. Sans corps, sans effet sur les colis.</p>
                <BlocCode>{`curl -X POST ${BASE_API}/auth \\
  -H "Authorization: Bearer $CLE"`}</BlocCode>
              </div>
              <div>
                <h4 className={s.h4}>Réponse 200</h4>
                <BlocCode>{`{
  "valide": true,
  "plateforme": "votre-code",
  "environnement": "live",
  "scopes": ["livraisons:statut"]
}`}</BlocCode>
              </div>
            </div>
          </div>

          <div className={s.ep}>
            <div className={s.epTop}>
              <span className={`${s.verb} ${s.verbGet}`}>GET</span>
              <span className={s.path}>/api/v1/statuts</span>
              <span className={s.epWhen}>au démarrage, puis en cache</span>
            </div>
            <div className={s.epBody}>
              <div>
                <h4 className={s.h4}>Rôle</h4>
                <p>
                  La liste des statuts que votre clé peut envoyer, avec leur libellé et leurs contraintes. Le
                  catalogue évolue rarement : lisez-le au démarrage de votre service.
                </p>
                <BlocCode>{`curl ${BASE_API}/statuts \\
  -H "Authorization: Bearer $CLE"`}</BlocCode>
              </div>
              <div>
                <h4 className={s.h4}>Réponse 200 — extrait</h4>
                <BlocCode>{`{
  "statuts": [
    {
      "statut": "reporte",
      "libelle": "Reporté",
      "dateRequise": true,
      "terminal": false,
      "description": "Livraison reportée : indiquer
                      la date de la prochaine tentative."
    }
  ]
}`}</BlocCode>
              </div>
            </div>
          </div>

          <div className={s.ep}>
            <div className={s.epTop}>
              <span className={`${s.verb} ${s.verbPost}`}>POST</span>
              <span className={s.path}>/api/v1/livraisons/statut</span>
              <span className={s.epWhen}>à chaque événement de tournée</span>
            </div>
            <div className={s.epBody}>
              <div>
                <h4 className={s.h4}>Corps</h4>
                <ul className={s.fields}>
                  <li>
                    <code>
                      codeSuivi<span className={s.req}>requis</span>
                    </code>
                    <span>
                      le code de suivi du colis, ex. <code>PD-000123</code>. La casse est indifférente. Vous pouvez
                      déclarer tout colis dont la <strong>ville de destination</strong> fait partie de celles que
                      vous desservez ; les autres répondent <code>404</code>.
                    </span>
                  </li>
                  <li>
                    <code>
                      statut<span className={s.req}>requis</span>
                    </code>
                    <span>
                      l&apos;une des {CATALOGUE_STATUTS_PRESTATAIRE.length} valeurs du catalogue ci-dessous.
                    </span>
                  </li>
                  <li>
                    <code>date</code>
                    <span>
                      ISO 8601 — <code>2026-09-15</code> ou <code>2026-09-15T14:30:00Z</code>.{' '}
                      <strong>Obligatoire</strong> pour{' '}
                      {familleDatees.map((statut, i) => (
                        <span key={statut.statut}>
                          {i > 0 && ' et '}
                          <code>{statut.statut}</code>
                        </span>
                      ))}
                      , ignorée pour les autres.
                    </span>
                  </li>
                  <li>
                    <code>note</code>
                    <span>facultative, {NOTE_MAX} caractères maximum.</span>
                  </li>
                </ul>
                <BlocCode>{`{
  "codeSuivi": "PD-000123",
  "statut": "reporte",
  "date": "2026-09-15",
  "note": "Client absent, repasse mardi"
}`}</BlocCode>
              </div>
              <div>
                <h4 className={s.h4}>Réponse 200</h4>
                <BlocCode>{`{
  "issue": "applique",
  "codeSuivi": "PD-000123",
  "statut": "reporte"
}`}</BlocCode>
                <p>
                  <code>issue</code> vaut <code>applique</code> quand le statut a été enregistré, ou{' '}
                  <code>inchange</code> quand le colis portait déjà ce statut. Renvoyer une déclaration déjà faite
                  n&apos;est <strong>jamais une erreur</strong> : vous pouvez rejouer sans risque après une coupure
                  réseau.
                </p>
              </div>
            </div>
          </div>

          <div className={s.ep}>
            <div className={s.epTop}>
              <span className={`${s.verb} ${s.verbPost}`}>POST</span>
              <span className={s.path}>/api/v1/livraisons/statut/lot</span>
              <span className={s.epWhen}>en fin de tournée</span>
            </div>
            <div className={s.epBody}>
              <div>
                <h4 className={s.h4}>Corps — {TAILLE_MAX_LOT_STATUTS} lignes maximum</h4>
                <BlocCode>{`{
  "livraisons": [
    { "codeSuivi": "PD-000123", "statut": "livre" },
    { "codeSuivi": "PD-000124", "statut": "reporte",
      "date": "2026-09-15" },
    { "codeSuivi": "PD-000125", "statut": "refuse",
      "note": "Refusé à la porte" }
  ]
}`}</BlocCode>
                <p>Chaque ligne suit exactement les règles de l&apos;endpoint unitaire.</p>
              </div>
              <div>
                <h4 className={s.h4}>Réponse 200</h4>
                <BlocCode>{`{
  "totalTraite": 2,
  "totalRefuse": 1,
  "resultats": [
    { "issue": "applique", "codeSuivi": "PD-000123", "statut": "livre" },
    { "issue": "applique", "codeSuivi": "PD-000124", "statut": "reporte" },
    { "issue": "refuse", "codeSuivi": "PD-000125",
      "code": "colis_introuvable",
      "message": "Aucun colis déclarable ne correspond à ce code de suivi" }
  ]
}`}</BlocCode>
                <p>
                  <strong>Une ligne en erreur n&apos;empêche pas les autres d&apos;être enregistrées.</strong> La
                  réponse est <code>200</code> dès que le lot a pu être lu ; le détail ligne par ligne est dans{' '}
                  <code>resultats</code>, dans l&apos;ordre d&apos;envoi.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Catalogue des statuts ---------- */}
        <section className={s.section}>
          <p className={s.eyebrow}>Catalogue</p>
          <h2 className={s.h2}>Les {CATALOGUE_STATUTS_PRESTATAIRE.length} statuts que vous pouvez envoyer</h2>
          <p className={s.intro}>
            Toute autre valeur est refusée. Envoyez la valeur exacte de la colonne de gauche.
          </p>

          <div className={s.groups}>
            <GroupeStatuts
              titre="Clôturent le colis"
              marque="définitif"
              aide="Après ces statuts, plus aucun changement n'est accepté sur le colis."
              statuts={familleTerminaux}
              clos
            />
            <GroupeStatuts
              titre="Exigent une date"
              marque="champ date"
              aide="Indiquez la date de la prochaine tentative, au format ISO 8601."
              statuts={familleDatees}
            />
            <GroupeStatuts
              titre="Échec de livraison"
              aide="La livraison n'a pas pu se faire."
              statuts={familleEchecs}
            />
            <GroupeStatuts
              titre="Contact avec le destinataire"
              aide="Suivi des tentatives d'appel avant livraison."
              statuts={familleContact}
            />
          </div>

          <h3 className={s.sousTitre}>Votre système utilise d&apos;autres libellés ?</h3>
          <p style={{ color: 'var(--ink-soft)', maxWidth: '62ch' }}>
            Correspondance avec le vocabulaire courant des outils de livraison :
          </p>
          <div className={s.map}>
            {CORRESPONDANCES.map(([leur, notre]) => (
              <div key={leur}>
                <span>{leur}</span>
                <b>{notre}</b>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Erreurs ---------- */}
        <section className={s.section}>
          <p className={s.eyebrow}>Erreurs</p>
          <h2 className={s.h2}>Lire une erreur</h2>
          <p className={s.intro}>
            Toutes les erreurs ont la même forme. Basez votre traitement sur <code>code</code>, qui ne change pas ;{' '}
            <code>message</code> est écrit pour un humain et peut être reformulé.
          </p>
          <div style={{ maxWidth: 640 }}>
            <BlocCode>{`{ "code": "date_requise", "message": "Le statut « reporte » exige une date…" }`}</BlocCode>
          </div>

          <div className={s.tw}>
            <table className={s.errs}>
              <thead>
                <tr>
                  <th>HTTP</th>
                  <th>code</th>
                  <th>Signification et action</th>
                </tr>
              </thead>
              <tbody>
                {ERREURS.map((erreur) => (
                  <tr key={erreur.codes.join('-')}>
                    <td>
                      <span className={`${s.http} ${erreur.http >= 500 ? s.h5xx : s.h4xx}`}>{erreur.http}</span>
                    </td>
                    <td className={s.c}>
                      {erreur.codes.map((code) => (
                        <span key={code} style={{ display: 'block' }}>
                          {code}
                        </span>
                      ))}
                    </td>
                    <td>{erreur.sens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------- Bonnes pratiques ---------- */}
        <section className={s.section}>
          <p className={s.eyebrow}>Bonnes pratiques</p>
          <h2 className={s.h2}>Ce qu&apos;il faut savoir avant la mise en production</h2>
          <p className={s.intro}>Quatre règles qui évitent l&apos;essentiel des incidents d&apos;intégration.</p>

          <div className={s.rules}>
            <div className={s.rule}>
              <h3 className={s.h3}>Rejouer est toujours sûr</h3>
              <p>
                Après un délai dépassé ou une coupure, renvoyez la même déclaration : si elle était déjà passée,
                vous recevez <code>inchange</code>, sans doublon de notre côté.
              </p>
            </div>
            <div className={s.rule}>
              <h3 className={s.h3}>Préférez le lot</h3>
              <p>
                Trente colis rentrés de tournée tiennent en une requête sur <code>/livraisons/statut/lot</code>.
                Au-delà de {TAILLE_MAX_LOT_STATUTS}, découpez en plusieurs lots.
              </p>
            </div>
            <div className={s.rule}>
              <h3 className={s.h3}>Des dates au format ISO</h3>
              <p>
                <code>2026-09-15</code>, jamais <code>15/09/2026</code> : une date ambiguë est refusée plutôt que
                devinée, pour qu&apos;un colis ne soit jamais relancé au mauvais jour.
              </p>
            </div>
            <div className={s.rule}>
              <h3 className={s.h3}>Surveillez l&apos;expiration de la clé</h3>
              <p>
                Quand une date d&apos;expiration est programmée sur votre clé, les réponses réussies des sept
                derniers jours portent l&apos;en-tête <code>mathio-key-deprecation</code>, avec cette date.
                Surveillez-le : une nouvelle clé vous est transmise avant l&apos;échéance, sans interruption de
                service.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- Premiers essais ---------- */}
        <section className={s.section}>
          <div className={s.notice}>
            <div>
              <p className={s.eyebrow}>Premiers essais</p>
              <h3 className={s.h3}>Il n&apos;y a pas d&apos;environnement de test</h3>
              <p>
                Chaque statut envoyé s&apos;applique à un colis réel. Pour vos premiers essais, nous vous
                confierons quelques <strong>colis de démonstration</strong> et vous communiquerons leurs codes de
                suivi.
              </p>
              <p>
                D&apos;ici là, vous pouvez tout développer : formats, correspondance des statuts, traitement des
                erreurs.
              </p>
            </div>
            <div>
              <p className={s.eyebrow}>Votre clé</p>
              <h3 className={s.h3}>Elle est personnelle</h3>
              <p>
                Ne la placez jamais dans une URL, dans un dépôt de code, dans un journal ou dans une application
                exécutée chez vos livreurs : elle doit rester côté serveur.
              </p>
              <p>
                En cas de doute sur une fuite, prévenez-nous : elle est révoquée immédiatement et une nouvelle vous
                est transmise.
              </p>
            </div>
          </div>
        </section>

        <footer className={s.pied}>
          <span>
            <b>Mathio Delivery</b> — API de suivi des livraisons, version 1
          </span>
          <span>
            Une question, une nouvelle clé : <b>{CONTACT}</b>
          </span>
        </footer>
      </div>
    </div>
  );
}
