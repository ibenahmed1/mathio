import { Inter_Tight, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

// Exposée en variable CSS (et non appliquée globalement) : seule la coquille
// marchande s'en sert pour l'instant, les espaces admin/terrain gardent leur
// typographie actuelle.
const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
})

// Police de tout le reste du système (--font-app dans app/globals.css) :
// back-office, espaces livreur/ramasseur, wizards, Kanban, Comptabilité.
// Elle arrivait jusqu'ici par un @import Google Fonts posé dans le module CSS
// de la barre latérale — donc chargée en cascade, et seulement là où ce module
// était monté, ce qui laissait le corps des pages en Arial.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata = {
  title: 'Mathio Delivery',
  description: 'Plateforme de livraison Mathio Delivery.',
  icons: {
    icon: '/mathio-logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className={`${jakarta.variable} ${interTight.variable}`}>
      <body>{children}</body>
    </html>
  )
}