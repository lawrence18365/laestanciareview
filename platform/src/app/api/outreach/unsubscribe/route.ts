import { NextRequest } from 'next/server';
import { db } from '@/db';
import { outreachProspects, outreachEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifyUnsubscribeToken } from '@/lib/outreach-tokens';

export const dynamic = 'force-dynamic';

const CONFIRMATION_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RateTap — Preferencias de correo</title>
  <style>
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
  </style>
</head>
<body>
  <div class="card">
    <h1>RateTap</h1>
    <p>Listo. No volverás a recibir correos de RateTap.</p>
  </div>
</body>
</html>`;

const GENERIC_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RateTap — Preferencias de correo</title>
  <style>
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
  </style>
</head>
<body>
  <div class="card">
    <h1>RateTap</h1>
    <p>El enlace no es válido o ha expirado. Si necesitas ayuda, contáctanos.</p>
  </div>
</body>
</html>`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get('id');
  const token = searchParams.get('token');

  const prospectId = rawId ? Number(rawId) : NaN;
  if (!Number.isInteger(prospectId) || prospectId <= 0) {
    return new Response(GENERIC_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const valid = await verifyUnsubscribeToken(prospectId, token);
  if (!valid) {
    return new Response(GENERIC_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const updated = await db
      .update(outreachProspects)
      .set({ status: 'opted_out' })
      .where(eq(outreachProspects.id, prospectId))
      .returning({ id: outreachProspects.id });

    if (updated.length > 0) {
      await db.insert(outreachEvents).values({
        prospectId,
        type: 'unsubscribed',
      });
    }
  } catch (err) {
    console.error('[outreach/unsubscribe] database error:', err);
    return new Response(GENERIC_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(CONFIRMATION_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
