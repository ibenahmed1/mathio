import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { listerColisExceptionnels, type TypeColisExceptionnel } from '@/lib/bon-envoi-exceptionnel';

// § BE exceptionnel — colis à cocher : ?prestataireId=…&type=stock|normal|tous&q=…
export async function GET(request: NextRequest) {
  try {
    await requirePermission('bon_envoi:create');
    const { searchParams } = request.nextUrl;
    const prestataireId = searchParams.get('prestataireId')?.trim();
    if (!prestataireId) throw new ApiError(400, 'Choisissez le transporteur');
    const brut = searchParams.get('type');
    const type: TypeColisExceptionnel = brut === 'stock' || brut === 'normal' ? brut : 'tous';
    return NextResponse.json(
      await listerColisExceptionnels({ prestataireId, type, recherche: searchParams.get('q') ?? undefined })
    );
  } catch (error) {
    return jsonError(error);
  }
}
