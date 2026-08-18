#!/usr/bin/env npx tsx
/**
 * RateTap — WhatsApp Blitz Pack (León audit motion)
 *
 * Why this exists: the email channel is empirically dead for León single
 * restaurants — a dry run of send-audit-emails.ts resolved 0 real emails
 * across 13 prospects (no website, IG/FB microsites, or template junk).
 * But every prospect has a phone number, and the audit page's primary CTA
 * is WhatsApp. So we deliver the SAME audit weapon over WhatsApp.
 *
 * Cold WhatsApp automation = ban (per GTM research), so this does NOT send.
 * It builds a ready-to-fire pack: per prospect, the live Google gap, a
 * personalized Spanish opener, the audit link, and a tap-to-send wa.me URL.
 * You fire them by hand from WhatsApp Web during the 10:00-11:30 "holy hour".
 *
 * Output:
 *   data/leads/whatsapp-blitz-YYYY-MM-DD.html  ← open this, tap each "Enviar"
 *   data/leads/whatsapp-blitz-YYYY-MM-DD.csv   ← send-log scaffold
 *
 * Usage:
 *   npx tsx scripts/lead-engine/whatsapp-blitz.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

// Known churned ex-trials whose restaurants.google_place_id is null (so the
// customer-table join can't catch them). Cold-pitching these looks clueless.
const EXCLUDE_PLACE_IDS = new Map<string, string>([
  // id 96 in restaurants: a demo/test account YOU set up (manager_email = your own,
  // contact "Leonardo Gasca", no place_id, no cards shipped, 1 same-day test review).
  // NOT a churned customer. Follow up directly with Leonardo, don't cold-pitch.
  ['ChIJtYGwFgC_K4QRrzcK2V5ekvk', 'cuenta demo/prueba que tú creaste (Leonardo Gasca, abril) — seguimiento directo, no en frío'],
]);

// Pulls live CRM state so the blitz can warm-open prospects who already viewed
// their audit and skip anyone who is/was a customer. Read-only. Degrades to
// all-cold if the DB is unreachable.
async function loadCrm(placeIds: string[]): Promise<{ viewed: Map<string, { count: number; last: string }>; skip: Map<string, string> }> {
  const viewed = new Map<string, { count: number; last: string }>();
  const skip = new Map(EXCLUDE_PLACE_IDS);
  if (!process.env.DATABASE_URL) return { viewed, skip };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const v = await pool.query(`select place_id, view_count, last_view_at::date as last from prospect_views where place_id = any($1)`, [placeIds]);
    for (const r of v.rows) viewed.set(r.place_id, { count: r.view_count, last: String(r.last) });
    const c = await pool.query(`select google_place_id, subscription_status from restaurants where google_place_id = any($1)`, [placeIds]);
    for (const r of c.rows) skip.set(r.google_place_id, `ya es cliente (${r.subscription_status})`);
  } catch (e) {
    console.warn('  (CRM lookup failed, treating all as cold):', e instanceof Error ? e.message : e);
  } finally {
    await pool.end();
  }
  return { viewed, skip };
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!.replace(/\\n/g, '').trim();
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
  .replace(/\\n/g, '').trim().replace(/\/$/, '');
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'leads');
const NEARBY_RADIUS = 3000;
const today = new Date().toISOString().split('T')[0];

// León prospects. Refillable: if data/leads/leon-prospects.json exists (produced
// by harvest-leon.ts) it's used; otherwise this hardcoded seed list of 13.
type Prospect = { name: string; placeId: string; phone: string };
const SEED_PROSPECTS: Prospect[] = [
  { name: '3 Campos Almuerzos Regionales', placeId: 'ChIJ30pIeLm_K4QRpbEMyqpUNRk', phone: '524775208324' },
  { name: 'Mendozzinos Pizza', placeId: 'ChIJc2coYNm-K4QRa8zjE_XfiS4', phone: '524774333585' },
  { name: 'Vancouver Wings León', placeId: 'ChIJR8bxY02-K4QR_DBOrbwkHXU', phone: '524777112551' },
  { name: 'Don Carbón León', placeId: 'ChIJNRcD11G_K4QRlOGA4pHOn_g', phone: '524778304295' },
  { name: 'Restaurant Martin', placeId: 'ChIJxVr-253AK4QRD6kqlPZWjtY', phone: '524777626373' },
  { name: 'Las Fabulosas Papas León', placeId: 'ChIJEbdGtq2_K4QRnFmJzJO05yw', phone: '524777709000' },
  { name: 'Lupillos', placeId: 'ChIJ15erbVC_K4QRp6TEVSFCVl4', phone: '524777176557' },
  { name: 'Factory Pizza Alitas & Bar', placeId: 'ChIJdxI8Zwu_K4QREiAJb9f578I', phone: '524777141515' },
  { name: 'KSushi León', placeId: 'ChIJE9s_OOS-K4QR33YCnDJuFZk', phone: '524777710720' },
  { name: 'Okuma Mariano Escobedo', placeId: 'ChIJwbiQs62_K4QRc_sAxxrZ8u8', phone: '524773901175' },
  { name: "Wing's Army", placeId: 'ChIJRyrXNlG_K4QRnl0izmLmp_8', phone: '524777173602' },
  { name: 'Green Place', placeId: 'ChIJF9bogK6_K4QRL323Kxbhl5M', phone: '524773327070' },
  { name: 'Mariscos Gus', placeId: 'ChIJi7ZeDKfAK4QR4My4-5IHyPw', phone: '524774708986' },
];

const PROSPECTS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'leads', 'leon-prospects.json');
function loadProspects(): Prospect[] {
  if (fs.existsSync(PROSPECTS_PATH)) {
    const list = JSON.parse(fs.readFileSync(PROSPECTS_PATH, 'utf8')) as Prospect[];
    const withPhone = list.filter((p) => p.phone && p.placeId);
    if (withPhone.length) {
      console.log(`  (using ${withPhone.length} prospects from leon-prospects.json)\n`);
      return withPhone;
    }
  }
  return SEED_PROSPECTS;
}
const PROSPECTS = loadProspects();

interface Place {
  name: string;
  rating: number;
  user_ratings_total: number;
  geometry: { location: { lat: number; lng: number } };
}

async function getPlaceDetails(placeId: string): Promise<Place | null> {
  const fields = 'name,rating,user_ratings_total,geometry';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&language=es&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json() as { status: string; result?: Place };
  return data.status === 'OK' && data.result ? data.result : null;
}

async function getAreaAvg(lat: number, lng: number, rating: number, excludeId: string) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${NEARBY_RADIUS}&type=restaurant&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json() as { results?: { place_id: string; rating?: number; user_ratings_total?: number }[] };
  const comps = (data.results || []).filter((p) => p.place_id !== excludeId && p.rating && (p.user_ratings_total ?? 0) >= 10);
  const ratings = [rating, ...comps.map((c) => c.rating!)];
  const areaAvg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  const ranking = [...comps.map((c) => c.rating!), rating].sort((a, b) => b - a);
  const myRank = ranking.indexOf(rating) + 1; // first index (ties favor prospect)
  return { areaAvg, total: ratings.length, myRank };
}

// The first-touch text. Cialdini-tuned: Reciprocity (custom audit led first),
// Authority (their live data), Liking + Unity (local founder, no feature dump),
// Commitment (a cheap micro-yes to close). No em dashes — they read as
// copy-paste/bot to a real owner.
//
// Offer (decided 2026-08-05): "Piloto fundador" — first 3 external pilots only.
// Zero cost today, no card required, 30 days free. If they continue after day 30,
// monthly starts at $700 MXN/mes and the $1,500 MXN setup/NFC fee is billed then.
// The message is explicit that nothing is paid today, but the later cost is still
// disclosed so there is no bait-and-switch.
function buildOpener(name: string, rating: number, areaAvg: number, gap: number, myRank: number, total: number, auditUrl: string): string {
  const dataLine = gap > 0.05
    ? `Va ${rating}★ y en su zona el promedio es ${areaAvg.toFixed(1)}★, así que ahorita aparece #${myRank} de ${total} ahí cerca. Le falta poquito para rebasar a varios.`
    : `Va ${rating}★ y aparece #${myRank} de ${total} en su zona. Buena base, pero el de junto lo puede rebasar rápido.`;
  return [
    `Buenos días 👋 Soy Lawrence, de RateTap, aquí mismo en León.`,
    ``,
    `Le armé una auditoría de ${name} con sus números reales de Google, gratis y sin compromiso. ${dataLine}`,
    ``,
    `Aquí ve contra quién compite y qué lo está frenando (lo abre en 30 seg): ${auditUrl}`,
    ``,
    `Estoy abriendo 3 lugares piloto en León: activamos una sucursal 30 días gratis, sin pagar nada hoy y sin tarjeta. Si después de los 30 días le funciona, ahí sí arranca la mensualidad de $700 y el setup de las tarjetas NFC. ¿Lo abre y me dice qué le pareció?`,
  ].join('\n');
}

// The 40-60s voice note to send right after the text. MX is the top voice-note
// cohort; research says text-only converts ~5x worse. This carries the mechanic.
function buildVoiceScript(name: string, rating: number): string {
  return [
    `Qué tal, muy buenos días. Oiga, soy Lawrence, de RateTap, aquí de León.`,
    `Le mandé la auditoría de ${name}. Mire, el problema casi nunca es la comida: es que el cliente contento se va feliz y no deja reseña, y el molesto sí se sienta a escribirla. Por eso su ${rating} estrellas no refleja qué tan bueno es.`,
    `Lo que hacemos es una tarjeta para la mesa: el cliente la toca con su teléfono, si le encantó se va directo a Google, y si algo salió mal le llega a usted en privado por WhatsApp antes de que lo publique. Aquí en León La Estancia las trae en sus doce sucursales y les subió la calificación sin gastar un peso en publicidad.`,
    `Activamos una sucursal treinta días gratis, sin pagar nada hoy y sin pedir tarjeta. Nada más estoy abriendo tres lugares piloto aquí en León. Si después de los treinta días le funciona, ahí sí arranca la mensualidad de setecientos pesos y el setup de las tarjetas NFC. Si no le mueve nada, lo quita y ya. Nomás dígame y le caigo con las tarjetas. Que tenga buen día.`,
  ].join(' ');
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\n  RATETAP — WHATSAPP BLITZ PACK · León · ${today}\n`);
  const { viewed, skip } = await loadCrm(PROSPECTS.map((p) => p.placeId));
  if (viewed.size) console.log(`  📊 ${viewed.size} con audit abierto en abril (fuente sin confirmar — pudo ser QA tuyo)`);
  if (skip.size) console.log(`  ⏭️  ${skip.size} excluidos (cuenta tuya / cliente)\n`);

  const rows: { name: string; phone: string; rating: number; areaAvg: number; gap: number; myRank: number; total: number; auditUrl: string; waUrl: string; opener: string; voice: string; warm: boolean; views: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const p of PROSPECTS) {
    if (skip.has(p.placeId)) { skipped.push({ name: p.name, reason: skip.get(p.placeId)! }); continue; }
    process.stdout.write(`  ${p.name}... `);
    const place = await getPlaceDetails(p.placeId);
    if (!place) { console.log('no Places data — skip'); continue; }
    const { areaAvg, total, myRank } = await getAreaAvg(
      place.geometry.location.lat, place.geometry.location.lng, place.rating, p.placeId,
    );
    const gap = areaAvg - place.rating;
    const auditUrl = `${BASE_URL}/audit/${p.placeId}`;
    const view = viewed.get(p.placeId);
    // NOTE: audit views are NOT reliably attributable to the prospect — the page
    // tracks every load including founder QA, and no IP/UA is stored. So we do
    // NOT assert "vi que le echó un ojo" in the message. The view is surfaced as
    // a founder-facing flag to verify, not as a claim sent to the owner.
    const opener = buildOpener(place.name, place.rating, areaAvg, gap, myRank, total, auditUrl);
    const voice = buildVoiceScript(place.name, place.rating);
    const waUrl = `https://wa.me/${p.phone}?text=${encodeURIComponent(opener)}`;
    rows.push({ name: place.name, phone: p.phone, rating: place.rating, areaAvg, gap, myRank, total, auditUrl, waUrl, opener, voice, warm: !!view, views: view?.count ?? 0 });
    console.log(`${place.rating}★  gap ${gap.toFixed(1)}  #${myRank}/${total}${view ? `  📊 audit abierto ${view.count}x abr (¿QA tuyo?)` : ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Warm leads first (most-viewed = hottest), then cold by pain (biggest gap).
  rows.sort((a, b) => (b.warm ? 1 : 0) - (a.warm ? 1 : 0) || b.views - a.views || b.gap - a.gap);
  if (skipped.length) {
    console.log(`\n  ⏭️  Excluidos del blast en frío:`);
    skipped.forEach((s) => console.log(`     ${s.name} — ${s.reason}`));
  }

  // ─── CSV send-log scaffold ───
  const csvPath = path.join(OUT_DIR, `whatsapp-blitz-${today}.csv`);
  const csv = ['name,phone,rating,area_avg,gap,rank,audit_url,wa_url,sent,replied,demo,trial,notes'];
  for (const r of rows) {
    csv.push([
      csvEscape(r.name), r.phone, r.rating, r.areaAvg.toFixed(2), r.gap.toFixed(2),
      `${r.myRank}/${r.total}`, r.auditUrl, csvEscape(r.waUrl), '', '', '', '', '',
    ].join(','));
  }
  fs.writeFileSync(csvPath, csv.join('\n'));

  // ─── HTML tap-to-send board ───
  const cards = rows.map((r, i) => `
    <div class="card${r.warm ? ' warm' : ''}" data-i="${i}">
      <div class="head">
        <span class="rank">#${i + 1}</span>
        <span class="name">${r.name}${r.warm ? ` <span class="hot">📊 AUDIT ABIERTO ${r.views}× ABR — ¿fuiste tú? verifica</span>` : ''}</span>
        <label class="done"><input type="checkbox" onchange="mark(${i},this.checked)"> enviado</label>
      </div>
      <div class="stats">
        <b>${r.rating}★</b> · zona ${r.areaAvg.toFixed(1)}★ ·
        <span class="${r.gap > 0.05 ? 'bad' : 'ok'}">${r.gap > 0.05 ? `${r.gap.toFixed(1)}★ abajo` : 'sobre el promedio'}</span>
        · #${r.myRank}/${r.total}
      </div>
      <pre class="msg">${r.opener.replace(/</g, '&lt;')}</pre>
      <div class="vlabel">🎙️ Nota de voz (grábala y mándala después del texto):</div>
      <pre class="voice">${r.voice.replace(/</g, '&lt;')}</pre>
      <div class="btns">
        <a class="send" href="${r.waUrl}" target="_blank" rel="noopener" onclick="mark(${i},true,this)">📲 Enviar por WhatsApp</a>
        <a class="audit" href="${r.auditUrl}" target="_blank" rel="noopener">Ver diagnóstico</a>
        <button class="copy" onclick="copyMsg(${i})">Copiar texto</button>
      </div>
    </div>`).join('\n');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RateTap — Blitz León ${today}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:16px;max-width:680px;margin:0 auto}
  h1{font-size:20px;color:#FBBF24}
  .sub{color:#94A3B8;font-size:13px;margin-bottom:20px;line-height:1.5}
  .card{background:#1E293B;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:14px}
  .card.sent{opacity:.45}
  .card.warm{border-color:#F59E0B;box-shadow:0 0 0 1px #F59E0B}
  .hot{color:#FBBF24;font-size:10px;font-weight:800;margin-left:6px;white-space:nowrap}
  .skipped{background:#1a1206;border:1px solid #422006;border-radius:12px;padding:12px 16px;margin-top:20px;font-size:12px;color:#A8A29E}
  .skipped b{color:#FBBF24}
  .head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .rank{color:#FBBF24;font-weight:800;font-size:13px}
  .name{font-weight:700;flex:1}
  .done{font-size:12px;color:#94A3B8;display:flex;gap:5px;align-items:center}
  .stats{font-size:13px;color:#CBD5E1;margin-bottom:10px}
  .bad{color:#F87171;font-weight:700}.ok{color:#34D399;font-weight:700}
  .msg,.voice{white-space:pre-wrap;background:#0F172A;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;color:#CBD5E1;max-height:0;overflow:hidden;transition:max-height .2s;margin:0}
  .voice{color:#A5B4FC;font-style:italic}
  .vlabel{color:#818CF8;font-size:11px;font-weight:700;max-height:0;overflow:hidden}
  .card.open .msg{max-height:600px;margin-bottom:10px}
  .card.open .voice{max-height:600px;margin-bottom:10px}
  .card.open .vlabel{max-height:30px;margin:4px 0}
  .btns{display:flex;gap:8px;flex-wrap:wrap}
  a,button{font-size:14px;font-weight:700;border-radius:10px;padding:11px 14px;text-decoration:none;border:0;cursor:pointer}
  .send{background:#25D366;color:#062f17;flex:1;text-align:center}
  .audit{background:transparent;color:#60A5FA;border:1px solid #334155}
  .copy{background:transparent;color:#94A3B8;border:1px solid #334155}
  .toggle{color:#64748B;font-size:12px;cursor:pointer;text-align:center;margin-top:6px}
  .bar{position:sticky;top:0;background:#0F172A;padding:8px 0;font-size:13px;color:#94A3B8}
</style></head><body>
<h1>📲 Blitz WhatsApp — León · ${today}</h1>
<div class="sub">${rows.length} prospectos${rows.some((r) => r.warm) ? ' (📊 arriba: audit abierto en abril — verifica si fuiste tú probando antes de tratarlos como tibios)' : ', ordenados por brecha'}.<br>
Ventana óptima: <b>mar/mié/jue 10:00–11:30 a.m.</b> Toca <b>Enviar</b> → WhatsApp Web abre el chat con el mensaje listo → revisa y manda. Espera ~30 seg entre cada uno. Graba una nota de voz de 40-60 seg después del texto (5× más efectivo en MX).</div>
<div class="bar" id="bar"></div>
${cards}
${skipped.length ? `<div class="skipped"><b>⏭️ Excluidos del blast en frío (${skipped.length}):</b><br>${skipped.map((s) => `${s.name} — ${s.reason}`).join('<br>')}</div>` : ''}
<script>
  const N=${rows.length};
  const KEY='blitz-${today}';
  let done=JSON.parse(localStorage.getItem(KEY)||'[]');
  const msgs=${JSON.stringify(rows.map((r) => r.opener))};
  function render(){document.getElementById('bar').textContent='Enviados: '+done.length+' / '+N;
    document.querySelectorAll('.card').forEach((c,i)=>{c.classList.toggle('sent',done.includes(i));});}
  function mark(i,on){if(on&&!done.includes(i))done.push(i);if(!on)done=done.filter(x=>x!==i);
    localStorage.setItem(KEY,JSON.stringify(done));render();}
  function copyMsg(i){navigator.clipboard.writeText(msgs[i]);}
  // tap card head toggles message preview
  document.querySelectorAll('.card').forEach((c)=>{c.querySelector('.stats').addEventListener('click',()=>c.classList.toggle('open'));});
  render();
</script></body></html>`;
  const htmlPath = path.join(OUT_DIR, `whatsapp-blitz-${today}.html`);
  fs.writeFileSync(htmlPath, html);

  console.log(`\n  ✅ ${rows.length} prospectos listos.`);
  console.log(`  📋 Tablero (ábrelo y dispara):  ${htmlPath}`);
  console.log(`  📊 Log:                         ${csvPath}\n`);
  console.log(`  open "${htmlPath}"\n`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
