import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand p-8 text-brand-foreground">
      <Logo size="lg" />
      <div className="text-center">
        <h1 className="page-title">Power Delivery — Scénario 1</h1>
        <p className="mt-1 text-sm opacity-70">Interfaces de test du backend Ramassage.</p>
      </div>
      <div className="flex gap-3">
        <Link href="/login" className="btn-primary bg-black text-white hover:brightness-110">
          Se connecter
        </Link>
        <Link href="/inscription" className="btn-outline border-black bg-white/60">
          Inscrire ma boutique
        </Link>
      </div>
    </main>
  );
}
