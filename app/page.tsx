import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function Page() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-brand p-6 text-brand-foreground sm:p-8">
      <Logo size="lg" />
      <div className="text-center">
        <h1 className="page-title">Mathio Delivery</h1>
        <p className="mt-1 text-sm opacity-70">Interfaces de test du backend Ramassage.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/login" className="btn-dark">
          Se connecter
        </Link>
        <Link href="/inscription" className="btn-outline border-black bg-white/60">
          Inscrire ma boutique
        </Link>
      </div>
    </main>
  );
}
