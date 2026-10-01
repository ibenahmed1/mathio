import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { configPushClient } from '@/lib/push-firebase';

// § Notifications — ce dont le navigateur a besoin pour s'abonner au push.
// Valeurs publiques par nature, mais servies à l'exécution plutôt qu'en
// NEXT_PUBLIC_* (figées au build, cf. lib/push-firebase.ts). `config: null`
// quand Firebase n'est pas configuré, ou pendant une impersonation : l'écran
// n'offre alors pas d'activer le push.
export async function GET() {
  try {
    const session = await requireUser();
    return NextResponse.json({ config: session.impersonated ? null : configPushClient() });
  } catch (error) {
    return jsonError(error);
  }
}
