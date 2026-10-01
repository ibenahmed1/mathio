import { NextResponse } from 'next/server';
import { spaceForHost, type SessionSpace } from '@/lib/spaces';

// § Notifications — manifeste d'application web (PWA).
//
// Sa raison d'être ici est le PUSH SUR IPHONE : Safari iOS ne l'autorise qu'à
// un site ajouté à l'écran d'accueil ET ouvert de là, en mode `standalone`.
// Sans manifeste, pas d'application installable, donc pas d'alerte pour les
// livreurs et marchands équipés d'un iPhone.
//
// Route plutôt que fichier statique : chaque domaine est une application à
// part (un nom, un point de départ), et c'est l'hôte qui le dit — même règle
// que partout ailleurs dans le dépôt (lib/spaces.ts).

const PAR_ESPACE: Record<SessionSpace, { nom: string; nomCourt: string; depart: string }> = {
  admin: { nom: 'Mathio Delivery — Back-office', nomCourt: 'Mathio Ops', depart: '/admin' },
  marchand: { nom: 'Mathio Delivery — Espace marchand', nomCourt: 'Mathio', depart: '/marchand' },
  // Livreurs et ramasseurs partagent le domaine : /login les aiguille chacun
  // vers son écran.
  terrain: { nom: 'Mathio Delivery — Terrain', nomCourt: 'Mathio Terrain', depart: '/login' },
};

export function GET(request: Request) {
  const espace = spaceForHost(request.headers.get('host')) ?? 'marchand';
  const { nom, nomCourt, depart } = PAR_ESPACE[espace];

  return NextResponse.json(
    {
      name: nom,
      short_name: nomCourt,
      start_url: depart,
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffd100',
      lang: 'fr',
      icons: [{ src: '/mathio-logo.png', sizes: '1080x1092', purpose: 'any' }],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } }
  );
}
