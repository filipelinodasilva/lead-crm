import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  UnauthorizedError,
  toErrorResponse,
} from '@/lib/auth/account';
import { ProspectError, ProviderError, QuotaError } from './types';

/** One place that turns prospecting errors into JSON responses. */
export function prospectErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return toErrorResponse(err);
  }
  if (err instanceof QuotaError) {
    return NextResponse.json(
      { error: err.message, code: 'quota' },
      { status: 429 }
    );
  }
  if (err instanceof ProviderError) {
    return NextResponse.json(
      { error: err.message, code: 'provider' },
      { status: err.status }
    );
  }
  if (err instanceof ProspectError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[prospect]', err);
  return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
}
