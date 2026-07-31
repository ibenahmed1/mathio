import './globals.css'

export const metadata = {
  title: 'Power Delivery — Scénario 1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}