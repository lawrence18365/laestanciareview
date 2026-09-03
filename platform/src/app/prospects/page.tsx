import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readFileSync } from 'fs';
import path from 'path';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { prospectQueue } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { buildProspectWhatsappUrl } from '@/lib/prospect-whatsapp';
import { ProspectActions } from './ProspectActions';

export const metadata: Metadata = {
  title: 'Prospectos — RateTap',
  robots: 'noindex',
};

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://app.ratetapmx.com';
const PAGE_SIZE = 200;

interface PainLineEntry {
  zone?: string;
  address?: string;
  pain_line_es?: string;
  maps_url?: string;
}

/**
 * Fail-soft: the pain-line JSON only exists on the founder's dev machine
 * (../data/leads/ is outside the Vercel deployment). In production this
 * returns {} and the per-card caption simply doesn't render. Pain lines
 * are display-only; the WhatsApp message copy lives in
 * src/lib/prospect-whatsapp.ts.
 */
function loadPainLines(): Record<string, PainLineEntry> {
  try {
    const file = path.resolve(process.cwd(), '../data/leads/prospect-pain-lines.json');
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, PainLineEntry>;
  } catch {
    return {};
  }
}

const STATUS_LABELS: Record<string, string> = {
  identified: 'Por contactar',
  pending: 'Pendiente',
  queued: 'En cola',
  sent: 'Contactado',
  replied: 'Respondió',
  booked: 'Demo',
  won: 'Ganado',
  lost: 'Perdido',
  failed: 'Falló',
  no_phone: 'Sin teléfono',
};

const STATUS_COLORS: Record<string, string> = {
  identified: '#94A3B8',
  pending: '#94A3B8',
  queued: '#60A5FA',
  sent: '#60A5FA',
  replied: '#FBBF24',
  booked: '#A78BFA',
  won: '#34D399',
  lost: '#F87171',
  failed: '#F87171',
  no_phone: '#64748B',
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'identified', label: 'Por contactar' },
  { value: 'sent', label: 'Contactados' },
  { value: 'replied', label: 'Respondieron' },
  { value: 'booked', label: 'Demo' },
  { value: 'won', label: 'Ganados' },
  { value: 'lost', label: 'Perdidos' },
];

function buildFilterHref(city: string, status: string): string {
  const params = new URLSearchParams();
  if (city) params.set('ciudad', city);
  if (status) params.set('estado', status);
  const qs = params.toString();
  return qs ? `/prospects?${qs}` : '/prospects';
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ ciudad?: string; estado?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');
  // Founder/owner-only board — mirrors /overview's role gate.
  if (session.role !== 'owner' && session.role !== 'regional') redirect('/dashboard');

  const { ciudad = '', estado = '' } = await searchParams;

  const conditions: SQL[] = [];
  if (ciudad) conditions.push(eq(prospectQueue.city, ciudad));
  if (estado) conditions.push(eq(prospectQueue.status, estado));

  const [rows, cityRows, statusCounts, totalRows] = await Promise.all([
    db
      .select()
      .from(prospectQueue)
      .where(conditions.length ? and(...conditions) : undefined)
      // 'identified' (por contactar) first, then biggest accounts first.
      .orderBy(
        sql`CASE WHEN ${prospectQueue.status} = 'identified' THEN 0 ELSE 1 END`,
        desc(prospectQueue.reviewCount),
      )
      .limit(PAGE_SIZE),
    db
      .selectDistinct({ city: prospectQueue.city })
      .from(prospectQueue)
      .where(sql`${prospectQueue.city} IS NOT NULL`)
      .orderBy(prospectQueue.city),
    db
      .select({ status: prospectQueue.status, n: sql<number>`count(*)::int` })
      .from(prospectQueue)
      .groupBy(prospectQueue.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(prospectQueue)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  const painLines = loadPainLines();
  const cities = cityRows.map((c) => c.city).filter((c): c is string => Boolean(c));
  const countBy = (s: string) => statusCounts.find((c) => c.status === s)?.n ?? 0;
  const total = statusCounts.reduce((acc, c) => acc + c.n, 0);
  const filteredTotal = totalRows[0]?.n ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '32px 16px 20px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '13px', color: '#FBBF24', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' }}>
          RateTap — Tablero de Prospectos
        </div>
        <h1 style={{ color: '#F8FAFC', fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>
          Hit List de Memo
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', fontSize: '12px', fontWeight: 700 }}>
          <span style={{ color: '#94A3B8', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: '999px' }}>
            Total: {total}
          </span>
          <span style={{ color: '#60A5FA', background: 'rgba(96,165,250,0.12)', padding: '4px 10px', borderRadius: '999px' }}>
            Contactados: {countBy('sent')}
          </span>
          <span style={{ color: '#FBBF24', background: 'rgba(251,191,36,0.12)', padding: '4px 10px', borderRadius: '999px' }}>
            Respondieron: {countBy('replied')}
          </span>
          <span style={{ color: '#A78BFA', background: 'rgba(167,139,250,0.12)', padding: '4px 10px', borderRadius: '999px' }}>
            Demos: {countBy('booked')}
          </span>
          <span style={{ color: '#34D399', background: 'rgba(52,211,153,0.12)', padding: '4px 10px', borderRadius: '999px' }}>
            Ganados: {countBy('won')}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {/* City chips */}
        <nav aria-label="Filtrar por ciudad" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
          <a
            href={buildFilterHref('', estado)}
            style={chipStyle(ciudad === '')}
          >
            Todas
          </a>
          {cities.map((c) => (
            <a key={c} href={buildFilterHref(c, estado)} style={chipStyle(ciudad === c)}>
              {c}
            </a>
          ))}
        </nav>

        {/* Status chips */}
        <nav aria-label="Filtrar por estado" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {STATUS_FILTERS.map((f) => (
            <a key={f.value} href={buildFilterHref(ciudad, f.value)} style={chipStyle(estado === f.value)}>
              {f.label}
            </a>
          ))}
        </nav>

        <p style={{ color: '#64748B', fontSize: '13px', margin: '0 0 12px' }}>
          Mostrando {rows.length} de {filteredTotal} prospectos. Toca WhatsApp → se abre el mensaje → manda. Luego marca el estado con un toque.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rows.map((p) => {
            const rating = p.rating ? parseFloat(p.rating) : null;
            const pain = painLines[p.placeId];
            return (
              <article
                key={p.placeId}
                style={{
                  background: '#1E293B',
                  borderRadius: '12px',
                  padding: '16px',
                  border: rating !== null && rating <= 4.0 && p.status === 'identified'
                    ? '1px solid rgba(239,68,68,0.3)'
                    : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 600, margin: 0 }}>
                      {p.restaurantName}
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '4px', fontSize: '13px' }}>
                      {rating !== null && (
                        <span style={{ color: rating <= 4.0 ? '#EF4444' : '#FBBF24', fontWeight: 700 }}>
                          {rating}★
                        </span>
                      )}
                      {p.reviewCount !== null && (
                        <span style={{ color: '#64748B' }}>
                          {p.reviewCount.toLocaleString('es-MX')} reseñas
                        </span>
                      )}
                      {p.city && <span style={{ color: '#64748B' }}>{p.city}</span>}
                    </div>
                    {pain?.pain_line_es && (
                      <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '6px', fontStyle: 'italic' }}>
                        {pain.pain_line_es}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      color: STATUS_COLORS[p.status] ?? '#94A3B8',
                      background: 'rgba(255,255,255,0.06)',
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: '999px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </div>

                {p.phone && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <a
                      href={buildProspectWhatsappUrl(p, p.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        background: '#25D366', color: '#fff',
                        padding: '12px', borderRadius: '8px',
                        fontSize: '15px', fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </a>
                    <a
                      href={`${BASE_URL}/audit/${p.placeId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255,255,255,0.08)', color: '#94A3B8',
                        padding: '12px 16px', borderRadius: '8px',
                        fontSize: '13px', fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Ver audit
                    </a>
                  </div>
                )}

                <div style={{ marginTop: '12px' }}>
                  <ProspectActions placeId={p.placeId} currentStatus={p.status} />
                </div>
              </article>
            );
          })}

          {rows.length === 0 && (
            <p style={{ color: '#64748B', textAlign: 'center', padding: '32px 0' }}>
              No hay prospectos con estos filtros.
            </p>
          )}
        </div>

        <div style={{ textAlign: 'center', padding: '24px 0 32px', color: '#475569', fontSize: '12px' }}>
          Mejor hora para contactar: martes-jueves, 10am-12:30pm o 4:30-6pm · Menciona La Estancia como caso de éxito
        </div>
      </div>
    </div>
  );
}

function chipStyle(active: boolean) {
  return {
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 700,
    textDecoration: 'none',
    border: active ? '1px solid #FBBF24' : '1px solid rgba(255,255,255,0.1)',
    background: active ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? '#FBBF24' : '#94A3B8',
  } as const;
}
