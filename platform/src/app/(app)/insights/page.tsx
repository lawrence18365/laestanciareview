import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import {
  FEATURE_SOURCES,
  getCampaignAnalytics,
  getFeatureAdoptionMatrix,
  getGroupSummary,
  getGuestFunnel,
  getLocationComparison,
  getProblemLocations,
  getPushAnalytics,
  getReviewFunnel,
  type FunnelStep,
  type IntegrityTag,
  type TrendedMetric,
} from '@/lib/product-analytics';

export const dynamic = 'force-dynamic';

/* ── Formatting helpers ── */

function fmt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMoney(n: number): string {
  return `$${fmt(n)}`;
}

function fmtDateTime(d: Date | string | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(d));
}

function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${Math.round(h * 10) / 10} h`;
}

/* ── Integrity badges ── */

const TAG_LABEL: Record<IntegrityTag, string> = {
  verified: 'VERIFICADO',
  reported: 'REPORTADO',
  inferred: 'INFERIDO',
};

const TAG_TITLE: Record<IntegrityTag, string> = {
  verified: 'Dato persistido en el servidor',
  reported: 'Capturado manualmente por el gerente',
  inferred: 'Derivado por heurística',
};

const TAG_STYLE: Record<IntegrityTag, React.CSSProperties> = {
  verified: { background: 'var(--green-light)', color: 'var(--green)' },
  reported: { background: 'var(--gold-light)', color: 'var(--gold)' },
  inferred: { background: 'rgba(163, 163, 163, 0.15)', color: 'var(--text-dim)' },
};

function IntegrityBadge({ tag }: { tag: IntegrityTag }) {
  return (
    <span
      title={TAG_TITLE[tag]}
      style={{
        ...TAG_STYLE[tag],
        fontSize: '0.55rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        padding: '2px 5px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
      }}
    >
      {TAG_LABEL[tag]}
    </span>
  );
}

/* ── Shared styles ── */

const sectionStyle: React.CSSProperties = {
  background: 'var(--panel-bg)',
  border: '1px solid var(--border-dark)',
  padding: '1.5rem',
};

const h2Style: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1.1rem',
  fontWeight: 600,
  color: 'var(--text-main)',
  margin: 0,
};

const subStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-dim)',
  margin: '0.25rem 0 1rem',
};

const thStyle = (align: 'left' | 'right' | 'center'): React.CSSProperties => ({
  textAlign: align,
  padding: '0.5rem 0.75rem',
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-dark)',
  whiteSpace: 'nowrap',
});

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
};

/* ── KPI tile ── */

function TrendLine({ metric, suffix }: { metric: TrendedMetric; suffix?: string }) {
  const diff = metric.value - metric.prev;
  if (diff === 0) {
    return <span style={{ color: 'var(--text-dim)' }}>sin cambio vs periodo anterior</span>;
  }
  const up = diff > 0;
  return (
    <span style={{ color: 'var(--text-dim)' }}>
      <span className="font-numeric" style={{ color: up ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
        {up ? '▲' : '▼'} {fmt(Math.abs(diff))}
        {suffix ?? ''}
      </span>{' '}
      vs periodo anterior
    </span>
  );
}

function KpiTile({
  label,
  metric,
  suffix,
  money,
  caveat,
}: {
  label: string;
  metric: TrendedMetric;
  suffix?: string;
  money?: boolean;
  caveat?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-dark)',
        padding: '1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
          title={caveat}
        >
          {label}
        </div>
        <IntegrityBadge tag={metric.tag} />
      </div>
      <div className="font-numeric" style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
        {money ? fmtMoney(metric.value) : fmt(metric.value)}
        {suffix ?? ''}
      </div>
      <div style={{ fontSize: '0.7rem' }}>
        <TrendLine metric={metric} suffix={suffix} />
      </div>
    </div>
  );
}

/* ── Funnel bars ── */

function FunnelBars({
  steps,
  conversions,
  barColor,
}: {
  steps: FunnelStep[];
  conversions: (number | null)[];
  barColor: string;
}) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {steps.map((step, i) => (
        <div key={step.key}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{step.label}</span>
            <span className="font-numeric" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {fmt(step.count)}
            </span>
            {conversions[i] !== null && (
              <span className="font-numeric" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                → {conversions[i]}%
              </span>
            )}
            <IntegrityBadge tag={step.tag} />
          </div>
          <div style={{ height: 10, background: 'var(--panel-border)', width: '100%' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(step.count > 0 ? 2 : 0, (step.count / max) * 100)}%`,
                background: barColor,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Sparkline (CSS bars) ── */

function SparkBars({
  data,
  color,
}: {
  data: { label: string; count: number }[];
  color: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40, minWidth: 120 }}>
      {data.map((d) => (
        <div
          key={d.label}
          title={`${d.label}: ${d.count}`}
          style={{
            flex: 1,
            height: `${Math.max(d.count > 0 ? 6 : 2, (d.count / max) * 100)}%`,
            background: d.count > 0 ? color : 'var(--panel-border)',
          }}
        />
      ))}
    </div>
  );
}

/* ── Page ── */

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'owner') redirect('/overview');

  const { days: daysParam } = await searchParams;
  const days: 7 | 30 = daysParam === '7' ? 7 : 30;

  const [summary, comparison, adoption, reviewFunnel, guestFunnel, campaigns, push, problems] =
    await Promise.all([
      getGroupSummary(days),
      getLocationComparison(days),
      getFeatureAdoptionMatrix(),
      getReviewFunnel(days),
      getGuestFunnel(days),
      getCampaignAnalytics(),
      getPushAnalytics(days),
      getProblemLocations(),
    ]);

  const featureKeys = adoption.features;

  return (
    <main style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 1400 }}>
      {/* ── a) Header ── */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#D97706' }}>
            Analítica de producto
          </p>
          <h1 style={{ margin: '0.35rem 0 0', fontFamily: 'var(--font-serif)', fontSize: '1.8rem', color: 'var(--text-main)' }}>
            Insights de producto — Grupo (últimos {days} días)
          </h1>
        </div>
        <nav style={{ display: 'flex', gap: '0.5rem' }} aria-label="Ventana de tiempo">
          {[7, 30].map((d) => (
            <a
              key={d}
              href={`/insights?days=${d}`}
              style={{
                padding: '0.4rem 0.9rem',
                fontSize: '0.7rem',
                fontWeight: days === d ? 700 : 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                color: days === d ? 'var(--panel-bg)' : 'var(--text-muted)',
                background: days === d ? 'var(--text-main)' : 'transparent',
                border: '1px solid var(--border-dark)',
              }}
            >
              {d} días
            </a>
          ))}
        </nav>
      </header>

      {/* ── b) KPI tiles ── */}
      <section aria-label="Indicadores del grupo">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
          <KpiTile label="Ubicaciones activas" metric={summary.activeLocations} />
          <KpiTile label="Usuarios activos" metric={summary.activeUsers} />
          <KpiTile label="Reseñas capturadas" metric={summary.reviewsCaptured} />
          <KpiTile label="Clics a Google" metric={summary.googleClicks} caveat={summary.caveat} />
          <KpiTile label="Feedback negativo" metric={summary.negativeFeedback} />
          <KpiTile label="Negativo con texto" metric={summary.negativeWithText} />
          <KpiTile label="% visto" metric={summary.pctViewed} suffix="%" />
          <KpiTile label="% resuelto" metric={summary.pctResolved} suffix="%" />
          <KpiTile label="Invitados capturados" metric={summary.guestsCaptured} />
          <KpiTile label="Invitados repetidores" metric={summary.repeatGuests} />
          <KpiTile label="% consentimiento" metric={summary.consentRate} suffix="%" />
          <KpiTile label="Campañas lanzadas" metric={summary.campaignsRun} />
          <KpiTile label="Reservas de campaña" metric={summary.campaignBookings} />
          <KpiTile label="Reservas confirmadas" metric={summary.bookedCount} />
          <KpiTile label="MX$ cobrado" metric={summary.mxCollected} money />
          <KpiTile label="MX$ elegible" metric={summary.mxEligible} money />
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', margin: '0.5rem 0 0' }}>{summary.caveat}</p>
      </section>

      {/* ── c) Location comparison ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Comparativo por ubicación</h2>
        <p style={subStyle}>Una fila por ubicación operativa; ventana de {days} días con Δ vs el periodo anterior.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle('left')}>Ubicación</th>
                <th style={thStyle('right')}>Usuarios activos <IntegrityBadge tag="inferred" /></th>
                <th style={thStyle('left')}>Última actividad <IntegrityBadge tag="inferred" /></th>
                <th style={thStyle('right')}>Reseñas (Δ) <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Feedback bajo <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>% resuelto <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Mediana h. a resolver <IntegrityBadge tag="inferred" /></th>
                <th style={thStyle('right')}>Invitados <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Reservas campaña <IntegrityBadge tag="reported" /></th>
                <th style={thStyle('right')}>MX$ cobrado <IntegrityBadge tag="reported" /></th>
                <th style={thStyle('right')}>Push subs <IntegrityBadge tag="verified" /></th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((loc) => {
                const delta = loc.reviews - loc.reviewsPrev;
                return (
                  <tr key={loc.restaurantId} style={{ borderTop: '1px solid var(--panel-border)' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{loc.name}</td>
                    <td style={tdNumStyle}><span className="font-numeric">{loc.activeUsers}</span></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtDateTime(loc.lastActiveAt)}</td>
                    <td style={tdNumStyle}>
                      <span className="font-numeric" style={{ fontWeight: 600 }}>{loc.reviews}</span>
                      {delta !== 0 && (
                        <span className="font-numeric" style={{ fontSize: '0.7rem', marginLeft: 4, color: delta > 0 ? 'var(--green)' : 'var(--red)' }}>
                          {delta > 0 ? '+' : ''}{delta}
                        </span>
                      )}
                    </td>
                    <td style={tdNumStyle}>
                      <span className="font-numeric">{loc.lowCount}</span>
                      {loc.lowWithText > 0 && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}> ({loc.lowWithText} con texto)</span>
                      )}
                    </td>
                    <td style={tdNumStyle}>
                      <span className="font-numeric">{loc.resolutionPct === null ? '—' : `${loc.resolutionPct}%`}</span>
                    </td>
                    <td style={tdNumStyle}><span className="font-numeric">{fmtHours(loc.medianHoursToResolve)}</span></td>
                    <td style={tdNumStyle}><span className="font-numeric">{loc.guestsCaptured}</span></td>
                    <td style={tdNumStyle}><span className="font-numeric">{loc.campaignBookings}</span></td>
                    <td style={tdNumStyle}><span className="font-numeric">{fmtMoney(loc.mxCollected)}</span></td>
                    <td style={tdNumStyle}><span className="font-numeric">{loc.pushSubscriptions}</span></td>
                  </tr>
                );
              })}
              {comparison.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, color: 'var(--text-dim)' }}>
                    Sin ubicaciones operativas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── d) Feature adoption matrix ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Matriz de adopción</h2>
        <p style={subStyle}>
          Días con uso en los últimos 30 días, por ubicación y funcionalidad.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle('left'), position: 'sticky', left: 0, background: 'var(--panel-bg)', zIndex: 1, minWidth: 140 }}>
                  Ubicación
                </th>
                {featureKeys.map((key) => (
                  <th key={key} style={{ ...thStyle('center'), minWidth: 72 }} title={FEATURE_SOURCES[key].source}>
                    {FEATURE_SOURCES[key].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adoption.locations.map((loc) => (
                <tr key={loc.restaurantId} style={{ borderTop: '1px solid var(--panel-border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--panel-bg)', zIndex: 1 }}>
                    {loc.name}
                  </td>
                  {featureKeys.map((key) => {
                    const cell = adoption.cells[loc.restaurantId]?.[key];
                    const state = cell?.state ?? 'unused';
                    const palette =
                      state === 'active'
                        ? { background: 'var(--green-light)', color: 'var(--green)' }
                        : state === 'occasional'
                          ? { background: 'var(--gold-light)', color: 'var(--gold)' }
                          : { background: 'rgba(163, 163, 163, 0.12)', color: 'var(--text-dim)' };
                    return (
                      <td
                        key={key}
                        title={`${FEATURE_SOURCES[key].label}: ${cell?.activeDays30 ?? 0} días activos de 30 · ${TAG_LABEL[FEATURE_SOURCES[key].tag]}`}
                        style={{ textAlign: 'center', padding: '0.4rem 0.3rem' }}
                      >
                        <span
                          className="font-numeric"
                          style={{
                            ...palette,
                            display: 'inline-block',
                            minWidth: 30,
                            padding: '3px 6px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            borderRadius: 2,
                          }}
                        >
                          {cell?.days30 ?? 0}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {adoption.locations.length === 0 && (
                <tr>
                  <td colSpan={featureKeys.length + 1} style={{ ...tdStyle, color: 'var(--text-dim)' }}>
                    Sin ubicaciones operativas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--green-light)', border: '1px solid var(--green)', marginRight: 4 }} />
            Activa: ≥8 días activos en 30d
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--gold-light)', border: '1px solid var(--gold)', marginRight: 4 }} />
            Ocasional: 1–7 días
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(163,163,163,0.12)', border: '1px solid var(--text-dim)', marginRight: 4 }} />
            Sin uso: 0 días
          </span>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
          Dueño/Regional <IntegrityBadge tag="inferred" />: dueño {fmt(adoption.multiViewUsage.owner.days7)} aperturas/vistas en 7d
          ({fmt(adoption.multiViewUsage.owner.days30)} en 30d) · regional {fmt(adoption.multiViewUsage.regional.days7)} en 7d
          ({fmt(adoption.multiViewUsage.regional.days30)} en 30d).
        </p>
      </section>

      {/* ── e) Funnels ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Embudos</h2>
        <p style={subStyle}>Ventana de {days} días. El % entre pasos es la conversión respecto al paso anterior.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Embudo de reseñas
            </h3>
            <FunnelBars steps={reviewFunnel.steps} conversions={reviewFunnel.conversions} barColor="var(--gold)" />
            {reviewFunnel.alertErrors > 0 && (
              <p style={{ fontSize: '0.7rem', color: 'var(--red)', margin: '0.5rem 0 0' }}>
                {reviewFunnel.alertErrors} alertas con error de envío.
              </p>
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Embudo de invitados
            </h3>
            <FunnelBars steps={guestFunnel.steps} conversions={guestFunnel.conversions} barColor="var(--green)" />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
              Ausentes 60d: {fmt(guestFunnel.lapsed60.value)} · Cumpleaños hoy: {fmt(guestFunnel.birthdaysToday.value)} · Visitas/invitado: {guestFunnel.visitsPerGuest.value}
            </p>
          </div>

          <div>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Embudo de push
            </h3>
            <FunnelBars
              steps={[
                { key: 'created', label: 'Creadas', count: push.created.value, tag: push.created.tag },
                { key: 'accepted', label: 'Aceptadas por el servicio (no entregadas)', count: push.accepted.value, tag: push.accepted.tag },
                { key: 'clicks', label: 'Clics', count: push.clicks.value, tag: push.clicks.tag },
                { key: 'destinationOpened', label: 'Destino abierto', count: push.destinationOpened.value, tag: push.destinationOpened.tag },
                { key: 'resultingAction', label: 'Acción resultante', count: push.resultingAction.value, tag: push.resultingAction.tag },
              ]}
              conversions={[
                null,
                push.created.value > 0 ? Math.round((push.accepted.value / push.created.value) * 1000) / 10 : null,
                push.accepted.value > 0 ? Math.round((push.clicks.value / push.accepted.value) * 1000) / 10 : null,
                push.clicks.value > 0 ? Math.round((push.destinationOpened.value / push.clicks.value) * 1000) / 10 : null,
                push.destinationOpened.value > 0 ? Math.round((push.resultingAction.value / push.destinationOpened.value) * 1000) / 10 : null,
              ]}
              barColor="var(--blue)"
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', margin: '0.5rem 0 0' }}>{push.note}</p>
          </div>
        </div>

        {/* Campaign table */}
        <h3 style={{ margin: '1.5rem 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Campañas
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle('left')}>Campaña</th>
                <th style={thStyle('left')}>Ubicación</th>
                <th style={thStyle('left')}>Estado</th>
                <th style={thStyle('right')}>Audiencia <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Abrieron WhatsApp <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Marcados enviados (auto-reportado) <IntegrityBadge tag="reported" /></th>
                <th style={thStyle('right')}>Respondieron <IntegrityBadge tag="verified" /></th>
                <th style={thStyle('right')}>Reservas <IntegrityBadge tag="reported" /></th>
                <th style={thStyle('right')}>MX$ cobrado <IntegrityBadge tag="reported" /></th>
                <th style={thStyle('right')}>Tasa reserva</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.campaignId} style={{ borderTop: '1px solid var(--panel-border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name}</td>
                  <td style={tdStyle}>{c.restaurantName}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                    {c.status}
                    {c.untouched && (
                      <span style={{ marginLeft: 6, color: 'var(--red)', fontSize: '0.7rem', fontWeight: 600 }}>sin actividad</span>
                    )}
                  </td>
                  <td style={tdNumStyle}><span className="font-numeric">{c.audience}</span></td>
                  <td style={tdNumStyle}><span className="font-numeric">{c.whatsappOpened}</span></td>
                  <td style={tdNumStyle}><span className="font-numeric">{c.markedSent}</span></td>
                  <td style={tdNumStyle}><span className="font-numeric">{c.replied}</span></td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric">{c.booked}</span>
                    {c.attended > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}> ({c.attended} asistieron)</span>}
                  </td>
                  <td style={tdNumStyle}><span className="font-numeric">{fmtMoney(c.collectedMx)}</span></td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric">{c.bookingRate === null ? '—' : `${Math.round(c.bookingRate * 1000) / 10}%`}</span>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...tdStyle, color: 'var(--text-dim)' }}>
                    Sin campañas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── f) Trends ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Tendencias</h2>
        <p style={subStyle}>Reseñas por día (ventana actual) e invitados por semana (12 semanas), por ubicación.</p>

        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Reseñas por día
        </h3>
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>Grupo</div>
          <SparkBars data={summary.reviewsByDay.map((d) => ({ label: d.date, count: d.count }))} color="var(--gold)" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {comparison.map((loc) => (
            <div key={loc.restaurantId} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loc.name}
              </span>
              <SparkBars data={loc.reviewsByDay.map((d) => ({ label: d.date, count: d.count }))} color="var(--gold)" />
            </div>
          ))}
        </div>

        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Invitados por semana
        </h3>
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>Grupo</div>
          <SparkBars data={guestFunnel.weeklyTrend.map((w) => ({ label: w.weekStart, count: w.count }))} color="var(--green)" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {guestFunnel.byLocation.map((loc) => (
            <div key={loc.slug} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loc.name}
              </span>
              <SparkBars data={loc.weekly.map((w) => ({ label: w.weekStart, count: w.count }))} color="var(--green)" />
            </div>
          ))}
        </div>
      </section>

      {/* ── g) Problem locations ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Ubicaciones con problemas</h2>
        <p style={subStyle}>Chequeos automáticos sobre la operación de cada ubicación.</p>
        {problems.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--green)', fontWeight: 600 }}>
            Ninguna ubicación tiene problemas detectados.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {problems.map((p) => (
              <div key={p.slug} style={{ border: '1px solid var(--panel-border)', padding: '0.75rem 1rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>{p.name}</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {p.issues.map((issue) => (
                    <span
                      key={issue}
                      style={{
                        background: 'var(--red-light)',
                        color: 'var(--red)',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 2,
                      }}
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── h) Data integrity notes ── */}
      <footer style={{ ...sectionStyle, borderColor: 'var(--panel-border)' }}>
        <h2 style={{ ...h2Style, fontSize: '0.95rem' }}>Notas de integridad de datos</h2>
        <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>
            <strong>sent_to_google</strong> significa «clic en la opción de Google» solo para reseñas creadas desde el 8 jul 2026; antes de esa fecha el campo no distingue la intención.
          </li>
          <li>
            Push <strong>«aceptadas»</strong> significa que el servicio de push respondió 2xx — no confirma entrega ni visualización en el dispositivo.
          </li>
          <li>
            <strong>«Marcado enviado»</strong>, las reservas y los montos de campaña son auto-reportados por el gerente.
          </li>
          <li>
            Los datos de aperturas de app y vistas de página (app_open / page_view) empiezan en la fecha del despliegue.
          </li>
          <li>
            <strong>reviewed_at / resolved_at</strong> existen solo desde el despliegue; los elementos anteriores solo tienen estado.
          </li>
        </ul>
      </footer>
    </main>
  );
}
