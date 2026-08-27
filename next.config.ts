import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise l'accès en dev depuis un autre appareil du même réseau local
  // (ex: téléphone en train de scanner un QR code) : sans ça, Next.js sert
  // bien la page (HTML), mais bloque silencieusement le JS (chunks + HMR)
  // dès que l'origine de la requête n'est pas localhost, donnant l'impression
  // que rien ne se passe au clic (voir "Blocked cross-origin request" dans
  // les logs du serveur). Ajouter ici toute IP locale utilisée pour tester
  // sur un vrai appareil.
  // Domaines wildcard pour les tunnels ngrok (URL différente à chaque
  // relance en compte gratuit) : nécessaire en plus de l'IP locale pour
  // tester la caméra (getUserMedia exige un contexte sécurisé HTTPS).
  // Hôtes de développement des trois espaces applicatifs (cf. SPACE_HOSTS_DEV
  // dans lib/spaces.ts) : les noms en `.localhost` résolvent vers la boucle
  // locale sans toucher au fichier hosts, et sont traités comme des origines
  // sûres par les navigateurs. Sans eux, `npm run dev` sert bien le HTML mais
  // bloque les chunks JS dès que l'hôte n'est pas littéralement "localhost".
  allowedDevOrigins: [
    "admin.localhost",
    "marchand.localhost",
    "app.localhost",
    "192.168.1.201",
    "192.168.1.93",
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.io",
    "*.ngrok.app",
  ],
};

export default nextConfig;
