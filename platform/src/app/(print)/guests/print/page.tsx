import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits, staff } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import PrintButton from './PrintButton';

function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function redemptionLabel(type: string | null): string {
  if (type === 'copa_vino') return 'Copa de vino';
  if (type === 'postre') return 'Postre';
  if (type === 'otro') return 'Otro';
  return '—';
}

export default async function GuestsPrintPage() {
  const session = await verifySession();
  if (!session || session.role !== 'gm') redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const brand = getBrandForSlug(session.slug);

  const [metricsResult, leaderboardResult, guestRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(distinct ${guests.id})`.mapWith(Number),
        validated: sql<number>`count(distinct ${guests.id}) filter (where ${guests.status} = 'validated')`.mapWith(Number),
        copaVino: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'copa_vino')`.mapWith(Number),
        postre: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'postre')`.mapWith(Number),
        otro: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'otro')`.mapWith(Number),
        activeStaff: sql<number>`count(distinct ${guests.validatedBy})`.mapWith(Number),
        firstCapture: sql<string | null>`min(${guests.capturedAt})`,
      })
      .from(guests)
      .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
      .where(eq(guestVisits.restaurantId, restaurant.id)),

    db
      .select({
        name: staff.name,
        count: sql<number>`count(${guests.id})`.mapWith(Number),
      })
      .from(guests)
      .innerJoin(staff, eq(staff.id, guests.validatedBy))
      .where(
        and(
          eq(staff.restaurantId, restaurant.id),
          eq(guests.status, 'validated'),
        ),
      )
      .groupBy(staff.id, staff.name)
      .orderBy(desc(sql`count(${guests.id})`))
      .limit(5),

    db
      .selectDistinct({
        name: guests.name,
        status: guests.status,
        redemptionType: guests.redemptionType,
        capturedAt: guests.capturedAt,
        preferences: guests.preferences,
      })
      .from(guests)
      .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
      .where(eq(guestVisits.restaurantId, restaurant.id))
      .orderBy(desc(guests.capturedAt))
      .limit(20),
  ]);

  const m = metricsResult[0];
  const hoursInOperation = m?.firstCapture
    ? Math.round((Date.now() - new Date(m.firstCapture).getTime()) / (1000 * 60 * 60))
    : 0;
  const hoursLabel = hoursInOperation < 72
    ? `${hoursInOperation}h`
    : `${Math.round(hoursInOperation / 24)}d`;

  const total = m?.total ?? 0;
  const validated = m?.validated ?? 0;
  const activeStaff = m?.activeStaff ?? 0;
  const copaVino = m?.copaVino ?? 0;
  const postre = m?.postre ?? 0;
  const otro = m?.otro ?? 0;

  const today = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const stats = [
    { value: total,       label: 'Invitados'     },
    { value: activeStaff, label: 'Meseros'        },
    { value: hoursLabel,  label: 'En operación'   },
    { value: validated,   label: 'Cortesías'      },
  ];

  return (
    <>
      <style>{PRINT_CSS}</style>

      {/* ── Toolbar (hidden when printing) ─── */}
      <div className="vip-toolbar">
        <a href="/guests" className="vip-back">← Club VIP</a>
        <PrintButton />
      </div>

      {/* ── Screen / print background ─── */}
      <div className="vip-bg">
        <div className="vip-doc">

          {/* ══════════════════ PAGE 1: COVER ══════════════════ */}
          <div className="vip-cover">

            {/* Header row: logo + name / date */}
            <div className="vip-cover-header">
              <div className="vip-cover-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logo} alt="" className="vip-logo" />
                <div>
                  <div className="vip-restaurant-name">{restaurant.name}</div>
                  {restaurant.city && (
                    <div className="vip-restaurant-city">{restaurant.city}</div>
                  )}
                </div>
              </div>
              <div className="vip-cover-date">{today}</div>
            </div>

            {/* Heavy rule */}
            <div className="vip-rule-heavy" />

            {/* Program title */}
            <div className="vip-program-wrap">
              <h1 className="vip-program-title">Club VIP</h1>
              <p className="vip-program-sub">Programa de Fidelización — Resultados</p>
            </div>

            {/* Hero metrics */}
            <div className="vip-metrics-grid">
              {stats.map((s, i) => (
                <div key={i} className="vip-metric">
                  <span className="vip-metric-value">{s.value}</span>
                  <span className="vip-metric-label">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Cortesías split */}
            {validated > 0 && (
              <div className="vip-split">
                <span>{validated} cortesías entregadas</span>
                {copaVino > 0 && (
                  <><span className="vip-split-dot">·</span><span>{copaVino} copa de vino</span></>
                )}
                {postre > 0 && (
                  <><span className="vip-split-dot">·</span><span>{postre} postre</span></>
                )}
                {otro > 0 && (
                  <><span className="vip-split-dot">·</span><span>{otro} otro</span></>
                )}
              </div>
            )}

            {/* Spacer pushes footer to bottom of page */}
            <div className="vip-cover-spacer" />

            {/* Page 1 footer */}
            <div className="vip-rule-light" />
            <div className="vip-cover-footer">
              <span>Sistema activo · {restaurant.name}</span>
              <span>app.ratetapmx.com</span>
            </div>
          </div>

          {/* ══════════════════ PAGE 2: DETAIL ══════════════════ */}
          <div className="vip-page-break" />

          <div className="vip-detail">

            {/* Top meseros */}
            {leaderboardResult.length > 0 && (
              <section className="vip-section">
                <div className="vip-section-label">Top Meseros</div>
                <table className="vip-lb-table">
                  <tbody>
                    {leaderboardResult.map((e, i) => (
                      <tr key={i}>
                        <td className="vip-lb-rank">{i + 1}</td>
                        <td className="vip-lb-name">{e.name}</td>
                        <td className="vip-lb-count">{e.count} {e.count === 1 ? 'validación' : 'validaciones'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Guest list */}
            {guestRows.length > 0 && (
              <section className="vip-section">
                <div className="vip-section-label">
                  Invitados Registrados
                  <span className="vip-section-note"> ({guestRows.length} de {total})</span>
                </div>
                <table className="vip-guest-table">
                  <thead>
                    <tr>
                      <Th>Nombre</Th>
                      <Th>Preferencias</Th>
                      <Th>Cortesía</Th>
                      <Th>Fecha</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {guestRows.map((g, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'vip-row-even' : ''}>
                        <td className="vip-td">{g.name}</td>
                        <td className="vip-td vip-td-muted">
                          {g.preferences && g.preferences.length > 0
                            ? g.preferences.join(', ')
                            : '—'}
                        </td>
                        <td className="vip-td">{redemptionLabel(g.redemptionType)}</td>
                        <td className="vip-td vip-td-muted">{fmtDate(g.capturedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Footer */}
            <div className="vip-rule-light" style={{ marginTop: '2rem' }} />
            <div className="vip-detail-footer">
              <span>{restaurant.name} · Club VIP · {today}</span>
              <span>Powered by RateTap · app.ratetapmx.com</span>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.4rem 0.6rem',
        fontSize: '0.58rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#78716c',
        borderBottom: '2px solid #1c1917',
      }}
    >
      {children}
    </th>
  );
}

const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;800&display=swap');

/* ── Print / page setup ───────────────────────────────────── */
@media print {
  @page { size: letter; margin: 1.5cm; }
  body, html { background: white !important; margin: 0 !important; }
  .vip-toolbar { display: none !important; }
  .vip-bg { background: white !important; padding: 0 !important; }
  .vip-doc {
    max-width: 100% !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .vip-cover { min-height: 9.5in; page-break-after: always; }
  .vip-page-break { display: none; }
}

/* ── Screen: toolbar ──────────────────────────────────────── */
.vip-toolbar {
  background: #1a1a1a;
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  position: sticky;
  top: 0;
  z-index: 100;
}
.vip-back {
  color: #aaa;
  font-size: 0.72rem;
  text-decoration: none;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-family: sans-serif;
}

/* ── Screen: outer background ─────────────────────────────── */
.vip-bg {
  background: #f0ede8;
  min-height: 100vh;
  padding: 2rem 1rem;
  font-family: Georgia, 'Times New Roman', serif;
}
.vip-doc {
  max-width: 780px;
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 4px 32px rgba(0,0,0,0.12);
}

/* ── Page 1: cover ────────────────────────────────────────── */
.vip-cover {
  padding: 3rem 3.5rem 2.5rem;
  display: flex;
  flex-direction: column;
  min-height: 820px; /* approx letter in screen px at 96dpi minus margins */
}
.vip-cover-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.vip-cover-brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.vip-logo {
  height: 44px;
  width: auto;
  object-fit: contain;
}
.vip-restaurant-name {
  font-family: Georgia, serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: 0.04em;
}
.vip-restaurant-city {
  font-family: sans-serif;
  font-size: 0.68rem;
  color: #78716c;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 0.2rem;
}
.vip-cover-date {
  font-family: sans-serif;
  font-size: 0.72rem;
  color: #78716c;
  letter-spacing: 0.04em;
  white-space: nowrap;
  padding-top: 0.2rem;
}

/* Rules */
.vip-rule-heavy {
  height: 3px;
  background: #1c1917;
  margin-bottom: 1.75rem;
}
.vip-rule-light {
  height: 1px;
  background: #e7e5e4;
}

/* Program title block */
.vip-program-wrap {
  text-align: center;
  margin-bottom: 2.5rem;
}
.vip-program-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 2.5rem;
  font-weight: 800;
  color: #1c1917;
  margin: 0;
  letter-spacing: -0.02em;
}
.vip-program-sub {
  font-family: sans-serif;
  font-size: 0.72rem;
  color: #78716c;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin: 0.5rem 0 0;
}

/* Metrics grid */
.vip-metrics-grid {
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  gap: 0.5rem;
  text-align: center;
  margin-bottom: 2rem;
}
.vip-metric {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.vip-metric-value {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 4.5rem;
  font-weight: 800;
  color: #1c1917;
  line-height: 1;
  letter-spacing: -0.03em;
  display: block;
}
.vip-metric-label {
  font-family: sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #78716c;
  margin-top: 0.5rem;
  display: block;
}

/* Cortesías split */
.vip-split {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-family: sans-serif;
  font-size: 0.82rem;
  color: #57534e;
  padding: 1rem 0;
  border-top: 1px solid #e7e5e4;
  border-bottom: 1px solid #e7e5e4;
}
.vip-split-dot { color: #d6d3d1; }

/* Cover footer */
.vip-cover-spacer { flex: 1; }
.vip-cover-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.85rem;
  font-family: sans-serif;
  font-size: 0.62rem;
  color: #a8a29e;
  letter-spacing: 0.06em;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* ── Page break ────────────────────────────────────────────── */
.vip-page-break {
  height: 2rem;
  background: #f0ede8;
}

/* ── Page 2: detail ───────────────────────────────────────── */
.vip-detail {
  padding: 2.5rem 3.5rem 2rem;
}
.vip-section {
  margin-bottom: 1.75rem;
}
.vip-section-label {
  font-family: sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #78716c;
  margin-bottom: 0.6rem;
}
.vip-section-note {
  font-weight: 400;
  letter-spacing: 0.08em;
  color: #a8a29e;
}

/* Leaderboard table */
.vip-lb-table {
  width: 100%;
  border-collapse: collapse;
}
.vip-lb-rank {
  padding: 0.5rem 0.5rem 0.5rem 0;
  font-family: sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  color: #78716c;
  width: 1.5rem;
}
.vip-lb-name {
  padding: 0.5rem 1rem 0.5rem 0;
  font-family: Georgia, serif;
  font-size: 0.95rem;
  font-weight: 700;
  color: #1c1917;
  border-bottom: 1px solid #f5f4f2;
}
.vip-lb-count {
  padding: 0.5rem 0;
  font-family: sans-serif;
  font-size: 0.78rem;
  color: #57534e;
  text-align: right;
  border-bottom: 1px solid #f5f4f2;
}

/* Guest table */
.vip-guest-table {
  width: 100%;
  border-collapse: collapse;
  font-family: sans-serif;
  font-size: 0.75rem;
}
.vip-td {
  padding: 0.4rem 0.6rem;
  color: #1c1917;
  border-bottom: 1px solid #f5f4f2;
}
.vip-td-muted { color: #78716c; }
.vip-row-even td { background: #faf8f6; }

/* Detail footer */
.vip-detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.75rem;
  font-family: sans-serif;
  font-size: 0.62rem;
  color: #a8a29e;
  letter-spacing: 0.05em;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* ── Responsive (screen only, won't matter in print) ──────── */
@media (max-width: 860px) {
  .vip-cover { padding: 2rem 2rem 2rem; }
  .vip-detail { padding: 2rem 2rem 1.5rem; }
  .vip-metric-value { font-size: 3rem; }
}
@media (max-width: 600px) {
  .vip-cover { padding: 1.5rem 1.25rem; }
  .vip-detail { padding: 1.5rem 1.25rem; }
  .vip-metrics-grid { flex-wrap: wrap; }
  .vip-metric { flex: 1 1 calc(50% - 0.5rem); }
  .vip-metric-value { font-size: 2.5rem; }
  .vip-program-title { font-size: 2rem; }
}
`;
