import { readFileSync } from 'fs';
import { join } from 'path';
import { escapeHtml, sendEmail } from '@/lib/email';
import { makeUnsubscribeToken } from '@/lib/outreach-tokens';
import { outreachProspects } from '@/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
  .replace(/\\n/g, '')
  .trim()
  .replace(/\/$/, '');

const WORDMARK_PATH = join(process.cwd(), 'public', 'ratetap-wordmark.png');

export type OutreachProspect = InferSelectModel<typeof outreachProspects>;

export interface OutreachTemplateResult {
  subject: string;
  text: string;
  html: string;
  attachments: {
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
  }[];
  headers: Record<string, string>;
}

function getWordmarkAttachment() {
  return {
    filename: 'ratetap-wordmark.png',
    content: readFileSync(WORDMARK_PATH),
    cid: 'ratetap-wordmark',
    contentType: 'image/png',
  };
}

export async function buildUnsubscribeUrl(prospectId: number): Promise<string> {
  const token = await makeUnsubscribeToken(prospectId);
  return `${BASE_URL}/api/outreach/unsubscribe?id=${prospectId}&token=${token}`;
}

function formatRating(rating: string | number | null): string {
  if (rating == null) return '';
  const n = typeof rating === 'string' ? Number(rating) : rating;
  if (!Number.isFinite(n)) return '';
  return `${n.toFixed(1)} estrellas en Google`;
}

function auditUrl(placeId: string | null): string | null {
  if (!placeId) return null;
  return `${BASE_URL}/audit/${encodeURIComponent(placeId)}`;
}

function whatsappUrl(phoneDigits: string, message: string): string {
  const digits = phoneDigits.replace(/\D/g, '');
  const withCountry = digits.length === 10 ? `52${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

const FOUNDER_WHATSAPP = '5212228822360';

const INTRO_PARAGRAPH =
  'Soy Lawrence, cofundador de RateTap. Lo usamos en los 12 restaurantes de Grupo La Estancia, en León, Querétaro, Puebla y Veracruz.';

const OFFER_PARAGRAPH =
  'Nosotros instalamos y capacitamos en persona. $1,500 de instalación, 30 días gratis, y después $700 al mes por sucursal. Si en 30 días no tiene 30 reseñas nuevas en Google, le devolvemos la instalación.';

function touch1Paragraphs(kind: 'leon' | 'group', prospect: OutreachProspect): string[] {
  const name = prospect.name;

  if (kind === 'group') {
    return [
      INTRO_PARAGRAPH,
      `Le escribo porque ${name} opera varias sucursales y hay una pregunta que casi ningún dueño puede contestar: ¿cuál de sus meseros atiende mejor y cuál tuvo una caída anormal en respuestas esta semana? Nosotros lo vemos mesero por mesero, turno por turno y sucursal por sucursal. En La Estancia, el 20% de los meseros genera el 43% de las reseñas de Google. Antes de medir, nadie sabía quiénes eran.`,
      `Funciona así: cada mesero trae una tarjeta. El comensal la toca al pagar. Si está contento, deja su reseña en Google. Si algo salió mal, la queja le llega a usted por WhatsApp, en privado, para que usted pueda responder primero.`,
      OFFER_PARAGRAPH,
      `¿Le enseño el tablero en una llamada de 15 minutos esta semana?`,
    ];
  }

  const ratingLine = prospect.rating ? ` Tiene ${formatRating(prospect.rating)}.` : '';
  const auditLink = auditUrl(prospect.placeId);
  const auditLine = auditLink
    ? `La puede ver aquí: ${auditLink}`
    : `Si me confirma su Place ID de Google, le armamos la auditoría en minutos.`;
  return [
    INTRO_PARAGRAPH,
    `Le preparé una auditoría de ${name} con los números reales de Google.${ratingLine} ${auditLine}`,
    OFFER_PARAGRAPH,
  ];
}

function touch2Paragraphs(kind: 'leon' | 'group', prospect: OutreachProspect): string[] {
  if (kind === 'group') {
    return [
      `Le comparto un dato de La Estancia León: 3 de 12 meseros generan el 63.7% de las reseñas. Un solo mesero, el 38.2%. Esos son los que no puede perder, y hoy casi ningún dueño sabe quiénes son.`,
      `¿Le muestro cómo se ve esto con los nombres de sus propios meseros? 15 minutos, cuando le acomode.`,
    ];
  }

  const auditLink = auditUrl(prospect.placeId);
  const auditLine = auditLink
    ? `La dejo aquí de nuevo: ${auditLink}`
    : `Cuando me confirme su Place ID de Google le armamos la auditoría.`;
  return [
    `¿Alcanzó a ver la auditoría de ${prospect.name}? ${auditLine}`,
    `Cada comentario crítico es una oportunidad de recuperar al cliente. RateTap ofrece a cada comensal la misma elección entre compartir su experiencia en Google o dejar feedback privado, para que el equipo pueda responder a tiempo.`,
  ];
}

function touch3Paragraphs(kind: 'leon' | 'group', prospect: OutreachProspect): string[] {
  const whatsapp = founderWhatsappUrl(prospect.name);
  if (kind === 'group') {
    return [
      `Este es el último correo que le envío. Si en algún momento quiere ver qué mesero pide y cuál no en cada una de sus sucursales, aquí estoy. Le dejo mi WhatsApp: ${whatsapp}`,
    ];
  }
  return [
    `Este es el último correo que le envío. Si en algún momento quiere ver cuál de sus meseros pide reseñas y cuál no, aquí estoy. Le dejo mi WhatsApp: ${whatsapp}`,
  ];
}

function typedBodyHtml(paragraphs: string[]): string {
  const parts: string[] = ['<div dir="ltr">'];
  paragraphs.forEach((para, i) => {
    parts.push(`<div>${para}</div>`);
    if (i < paragraphs.length - 1) {
      parts.push('<div><br></div>');
    }
  });
  parts.push('</div>');
  return parts.join('');
}

function plainTextBody(paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}

function footerHtml(unsubscribeUrl: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <tr>
    <td style="border-top:2px solid #2563EB;padding-top:16px;">
      <img src="cid:ratetap-wordmark" alt="RateTap" height="34" style="height:34px;display:block;border:0;">
    </td>
  </tr>
  <tr>
    <td style="padding-top:12px;font-size:14px;line-height:1.4;">
      <span style="color:#2563EB;font-weight:bold;">Lawrence</span>
      <span style="color:#9CA3AF;"> · </span>
      <span style="color:#9CA3AF;">Fundador, RateTap</span>
    </td>
  </tr>
  <tr>
    <td style="padding-top:4px;font-size:13px;font-style:italic;color:#9CA3AF;">
      Convierte a tus comensales en reseñas de Google.
    </td>
  </tr>
  <tr>
    <td style="padding-top:12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9CA3AF;padding-right:8px;">WEB</td>
          <td style="font-size:13px;color:#2563EB;">app.ratetapmx.com</td>
        </tr>
        <tr>
          <td style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9CA3AF;padding-right:8px;">EMAIL</td>
          <td style="font-size:13px;color:#2563EB;">hello@ratetapmx.com</td>
        </tr>
        <tr>
          <td style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9CA3AF;padding-right:8px;">WHATSAPP</td>
          <td style="font-size:13px;color:#2563EB;">+52 1 222 882 2360</td>
        </tr>
        <tr>
          <td style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9CA3AF;padding-right:8px;">BASE</td>
          <td style="font-size:13px;color:#2563EB;">León, Guanajuato, México</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid #F3F4F6;padding-top:12px;margin-top:12px;font-size:11px;color:#9CA3AF;line-height:1.5;">
      Recibes este correo porque creo que RateTap puede servirle a tu restaurante. Responde 'baja' o usa <a href="${escapeHtml(unsubscribeUrl)}" style="color:#2563EB;text-decoration:underline;">este enlace</a> y te elimino de inmediato.
    </td>
  </tr>
</table>`;
}

function footerText(unsubscribeUrl: string): string {
  return [
    '-- ',
    'Lawrence · Fundador, RateTap',
    'Convierte a tus comensales en reseñas de Google.',
    'WEB app.ratetapmx.com',
    'EMAIL hello@ratetapmx.com',
    'WHATSAPP +52 1 222 882 2360',
    'BASE León, Guanajuato, México',
    '',
    `Recibes este correo porque creo que RateTap puede servirle a tu restaurante. Responde 'baja' o usa este enlace y te elimino de inmediato: ${unsubscribeUrl}`,
  ].join('\n');
}

export async function buildOutreachEmail(
  prospect: OutreachProspect,
  touchNumber: 1 | 2 | 3,
): Promise<OutreachTemplateResult> {
  const unsubscribeUrl = await buildUnsubscribeUrl(prospect.id);
  const kind = prospect.kind === 'group' ? 'group' : 'leon';

  let paragraphs: string[];
  let subject: string;

  if (touchNumber === 1) {
    subject =
      kind === 'group'
        ? '¿Cuál de sus sucursales está pidiendo y cuál no?'
        : '¿Sabe cuál de sus meseros atiende mejor?';
    paragraphs = touch1Paragraphs(kind, prospect);
  } else if (touchNumber === 2) {
    subject =
      kind === 'group'
        ? 'Re: ¿Cuál de sus sucursales está pidiendo y cuál no?'
        : `¿Alcanzó a ver la auditoría de ${prospect.name}?`;
    paragraphs = touch2Paragraphs(kind, prospect);
  } else {
    subject = `Último correo sobre ${prospect.name}`;
    paragraphs = touch3Paragraphs(kind, prospect);
  }

  const htmlBody = typedBodyHtml(paragraphs);
  const html = `${htmlBody}\n${footerHtml(unsubscribeUrl)}`;
  const text = `${plainTextBody(paragraphs)}\n${footerText(unsubscribeUrl)}`;

  return {
    subject,
    text,
    html,
    attachments: [getWordmarkAttachment()],
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function sendOutreachEmail(
  prospect: OutreachProspect,
  touchNumber: 1 | 2 | 3,
): Promise<{ subject: string }> {
  const { subject, text, html, attachments, headers } = await buildOutreachEmail(prospect, touchNumber);
  await sendEmail({
    to: prospect.email,
    from: 'Lawrence de RateTap <hello@ratetapmx.com>',
    replyTo: 'hello@ratetapmx.com',
    subject,
    html,
    text,
    attachments,
    headers,
  });
  return { subject };
}

export function founderWhatsappUrl(restaurantName: string): string {
  const message = `Hola Lawrence, vi su correo sobre ${restaurantName}. Me interesa ver el tablero.`;
  return whatsappUrl(FOUNDER_WHATSAPP, message);
}

export function hotLeadWhatsappUrl(prospect: OutreachProspect): string {
  const phone = prospect.phone ? prospect.phone.replace(/\D/g, '') : '';
  const digits = phone.length >= 10 ? phone : FOUNDER_WHATSAPP;
  const message = `Hola, soy Lawrence de RateTap. Vi que revisó la auditoría de ${prospect.name}. ¿Le quedó alguna duda?`;
  return whatsappUrl(digits, message);
}
