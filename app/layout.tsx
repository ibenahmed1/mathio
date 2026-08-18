import { Inter_Tight } from 'next/font/google'
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

export const metadata = {
  title: 'Power Delivery — Scénario 1',
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
    <html lang="fr" className={interTight.variable}>
      <body>{children}</body>
    </html>
  )
}