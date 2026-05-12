import { NextRequest } from 'next/server';
import { z } from 'zod';
import { checkRateLimitAsync, getClientIP } from '@/lib/rate-limit';
import { sendLeadEvent } from '@/lib/meta-conversions';
import { trackCommercialEvent, upsertCommercialLead } from '@/lib/commercial-tracking';

export const runtime = 'nodejs';

const LEAD_LIMIT = 20;
const LEAD_WINDOW = 10 * 60_000;

function emptyToUndefined(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned : undefined;
}

const optionalText = (max = 255) =>
  z.preprocess(emptyToUndefined, z.string().max(max).optional());

const leadSchema = z.object({
  name: optionalText(160),
  businessName: z.preprocess(
    emptyToUndefined,
    z.string().min(2, 'Business name is required').max(180),
  ),
  email: z.preprocess(
    emptyToUndefined,
    z.string().email().max(254).optional(),
  ),
  phone: optionalText(40),
  city: optionalText(120),
  source: optionalText(120),
  landingPath: optionalText(600),
  utmSource: optionalText(160),
  utmMedium: optionalText(160),
  utmCampaign: optionalText(200),
  utmTerm: optionalText(200),
  utmContent: optionalText(200),
  offer: optionalText(120),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => value.email || value.phone, {
  message: 'Email or phone is required',
  path: ['email'],
});

function configuredAllowedOrigins(): Set<string> {
  const origins = new Set([
    'https://ratetapmx.com',
    'https://www.ratetapmx.com',
    'https://app.ratetapmx.com',
    'http://localhost:3000',
    'http://localhost:3100',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3100',
  ]);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (baseUrl) {
    try {
      origins.add(new URL(baseUrl).origin);
    } catch {
      // Ignore invalid env values; the API will still use the defaults above.
    }
  }

  for (const origin of (process.env.LEADS_ALLOWED_ORIGINS ?? '').split(',')) {
    const cleaned = origin.trim();
    if (cleaned) origins.add(cleaned);
  }

  return origins;
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return configuredAllowedOrigins().has(origin);
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function json(req: NextRequest, body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders(req.headers.get('origin')),
      ...(init?.headers ?? {}),
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403, headers: corsHeaders(origin) });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return await req.json();
  }

  const form = await req.formData();
  const body: Record<string, unknown> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') body[key] = value;
  });
  return body;
}

function getString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeBody(body: Record<string, unknown>) {
  const firstName = getString(body, 'first_name', 'firstName');
  const lastName = getString(body, 'last_name', 'lastName');
  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    name: getString(body, 'name', 'contact_name', 'contactName', 'your-name') ?? joinedName,
    businessName: getString(
      body,
      'businessName',
      'business_name',
      'restaurant_name',
      'restaurant-name',
      'restaurant',
      'company',
      'company_name',
    ),
    email: getString(body, 'email'),
    phone: getString(body, 'phone', 'telefono', 'tel', 'whatsapp'),
    city: getString(body, 'city', 'ciudad'),
    source: getString(body, 'source', 'source_page', 'sourcePage') ?? 'public_form',
    landingPath: getString(body, 'landingPath', 'landing_path', 'page_path', 'landing_url'),
    utmSource: getString(body, 'utmSource', 'utm_source'),
    utmMedium: getString(body, 'utmMedium', 'utm_medium'),
    utmCampaign: getString(body, 'utmCampaign', 'utm_campaign'),
    utmTerm: getString(body, 'utmTerm', 'utm_term'),
    utmContent: getString(body, 'utmContent', 'utm_content'),
    offer: getString(body, 'offer') ?? 'demo',
    metadata: {
      form_id: getString(body, 'form_id', 'formId'),
      source_cluster: getString(body, 'source_cluster', 'sourceCluster'),
      cta_context: getString(body, 'cta_context', 'ctaContext'),
      origin_cta_context: getString(body, 'origin_cta_context', 'originCtaContext'),
      language: getString(body, 'language'),
      referrer: getString(body, 'referrer'),
      landing_url: getString(body, 'landing_url', 'landingUrl'),
      preferred_date: getString(body, 'preferred_date', 'preferredDate'),
    },
  };
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return json(req, { error: 'Origin not allowed' }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`commercial-lead:${ip}`, LEAD_LIMIT, LEAD_WINDOW);
  if (!rl.allowed) {
    return json(
      req,
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      },
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = await readBody(req);
  } catch {
    return json(req, { error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(normalizeBody(raw));
  if (!parsed.success) {
    return json(
      req,
      { error: 'Invalid lead', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { lead, deduped } = await upsertCommercialLead(parsed.data);
    await trackCommercialEvent({
      eventName: 'demo_requested',
      leadId: lead.id,
      source: parsed.data.source,
      path: parsed.data.landingPath,
      metadata: {
        offer: parsed.data.offer,
        deduped,
      },
    });

    const metaEventId = deduped ? null : `lead-${lead.id}-${Date.now()}`;
    if (metaEventId) {
      try {
        await sendLeadEvent({
          email: parsed.data.email,
          phone: parsed.data.phone,
          eventId: metaEventId,
          custom: {
            content_category: 'commercial_lead',
            offer: parsed.data.offer ?? 'unknown',
            source: parsed.data.source ?? 'unknown',
          },
        });
      } catch (err) {
        console.error('[leads/create] Meta CAPI failed:', err);
      }
    }

    return json(req, {
      ok: true,
      leadId: lead.id,
      deduped,
      metaEventId,
    });
  } catch (err) {
    console.error('[leads/create] failed:', err);
    return json(req, { error: 'Could not save lead' }, { status: 500 });
  }
}
