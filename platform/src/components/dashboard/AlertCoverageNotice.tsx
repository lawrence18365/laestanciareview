/**
 * Push-alert coverage for the owner overview. The count is locations with at
 * least one non-revoked push subscription — a *registered alert*, not an
 * installed device: a location whose phones all have RateTap installed still
 * shows up here until someone taps «Activar notificaciones». The copy says so.
 *
 * Server-safe (no hooks, no browser APIs) and honest about failure: `null`
 * means the coverage query could not be read, which is not the same as 0.
 */

export interface AlertCoverage {
  covered: number;
  total: number;
  missing: string[];
}

const AMBER_BOX = {
  background: '#FFFBEB',
  border: '1px solid #D97706',
  color: '#92400E',
  padding: '0.75rem 1rem',
} as const;

const MUTED = { color: 'var(--text-muted)' } as const;

const HOW_TO_ENABLE =
  'Se activan en RateTap con «Activar notificaciones» en cada teléfono o iPad. Un registro no confirma que la alerta llegó.';

export default function AlertCoverageNotice({ coverage }: { coverage: AlertCoverage | null }) {
  if (coverage === null) {
    return <p style={{ margin: 0, ...MUTED }}>Alertas push: estado no disponible</p>;
  }

  if (coverage.total === 0) return null;

  const summary = `Alertas push activadas: ${coverage.covered}/${coverage.total} ubicaciones`;

  if (coverage.missing.length === 0) {
    return <p style={{ margin: 0, ...MUTED }}>{summary}</p>;
  }

  return (
    <div style={AMBER_BOX}>
      <p style={{ margin: 0, fontWeight: 600 }}>{summary}</p>
      <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Sin alertas configuradas: {coverage.missing.join(', ')}
      </p>
      <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
        {HOW_TO_ENABLE}
      </p>
    </div>
  );
}
