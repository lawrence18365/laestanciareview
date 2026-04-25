import { clearSession } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin';

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  await clearSession();
  return Response.json({ ok: true });
}
