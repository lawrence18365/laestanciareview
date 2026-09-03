import { NextRequest } from 'next/server';
import { db } from '@/db';
import { outreachProspects, outreachEvents } from '@/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { verifyUnsubscribeToken } from '@/lib/outreach-tokens';

export const dynamic = 'force-dynamic';

const PAGE_STYLES = `
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f9f9f8;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #111111;
      text-align: center;
      padding: 1.5rem;
    }
    .card {
      background: #ffffff;
      border: 1px solid #111111;
      padding: 2.5rem;
      max-width: 420px;
      width: 100%;
    }
    h1 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 1rem;
    }
    p {
      margin: 0;
      font-size: 1rem;
      line-height: 1.6;
      color: #44403c;
    }
    button {
      margin-top: 1.5rem;
      padding: 0.75rem 2rem;
      background: #111111;
      color: #ffffff;
      border: none;
      font-size: 1rem;
      font-family: inherit;
      cursor: pointer;
    }
`;

function page(body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RateTap — Preferencias de correo</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
  <div class="card">
    <h1>RateTap</h1>
    ${body}
  </div>
</body>
</html>`;
}

const CONFIRMATION_HTML = page('<p>Listo. No volverá a recibir correos de RateTap.</p>');

const ALREADY_HTML = page('<p>Ya estaba dado de baja. No volverá a recibir correos de RateTap.</p>');

const GENERIC_HTML = page(
  '<p>El enlace no es válido o ha expirado. Si necesita ayuda, contáctenos.</p>',
);

function confirmHtml(actionUrl: string): string {
  const action = actionUrl.replace(/&/g, '&amp;');
  return page(`
    <p>¿Seguro que quiere dejar de recibir correos de RateTap?</p>
    <form method="post" action="${action}">
      <button type="submit">Confirmar baja</button>
    </form>
  `);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function parseParams(req: NextRequest): { prospectId: number; token: string | null } | null {
  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get('id');
  const token = searchParams.get('token');
  const prospectId = rawId ? Number(rawId) : NaN;
  if (!Number.isInteger(prospectId) || prospectId <= 0) return null;
  return { prospectId, token };
}

/**
 * GET only confirms intent: it validates the link and shows a confirmation
 * page with a button. It MUST NOT change prospect state (mail scanners and
 * link prefetchers issue GETs). The actual unsubscribe happens on POST —
 * either from the button or from a one-click List-Unsubscribe=One-Click
 * POST (RFC 8058).
 */
export async function GET(req: NextRequest) {
  const params = parseParams(req);
  if (!params) return htmlResponse(GENERIC_HTML);

  const valid = await verifyUnsubscribeToken(params.prospectId, params.token);
  if (!valid) return htmlResponse(GENERIC_HTML);

  return htmlResponse(confirmHtml(req.url));
}

export async function POST(req: NextRequest) {
  const params = parseParams(req);
  if (!params) return htmlResponse(GENERIC_HTML);

  const valid = await verifyUnsubscribeToken(params.prospectId, params.token);
  if (!valid) return htmlResponse(GENERIC_HTML);

  try {
    const rows = await db
      .select({ status: outreachProspects.status })
      .from(outreachProspects)
      .where(eq(outreachProspects.id, params.prospectId))
      .limit(1);

    if (rows.length === 0) return htmlResponse(GENERIC_HTML);

    if (rows[0].status === 'opted_out') {
      // Already unsubscribed: do not insert a duplicate event.
      return htmlResponse(ALREADY_HTML);
    }

    const updated = await db
      .update(outreachProspects)
      .set({ status: 'opted_out' })
      .where(and(eq(outreachProspects.id, params.prospectId), ne(outreachProspects.status, 'opted_out')))
      .returning({ id: outreachProspects.id });

    if (updated.length > 0) {
      await db.insert(outreachEvents).values({
        prospectId: params.prospectId,
        type: 'unsubscribed',
      });
    }

    return htmlResponse(CONFIRMATION_HTML);
  } catch (err) {
    console.error('[outreach/unsubscribe] database error:', err);
    return htmlResponse(GENERIC_HTML);
  }
}
