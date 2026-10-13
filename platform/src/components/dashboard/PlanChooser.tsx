'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '@/lib/i18n';
import { track } from '@/lib/analytics-client';

type Cycle = 'monthly' | 'annual';

/** "MX$2,490": whole pesos, es-MX grouping. */
export function formatMx(amount: number): string {
  return `MX$${amount.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

/** Whole months of the monthly price the annual plan saves, 0 when none. */
export function monthsFree(monthly: number, annual: number): number {
  return Math.max(0, Math.floor(12 - annual / monthly));
}

/**
 * Self-serve plan picker. Prices arrive as props, read from env on the server;
 * nothing here is hardcoded. Annual is preselected as the recommended cycle.
 * The one CTA posts the chosen cycle to the existing Mercado Pago subscribe
 * route and follows its init_point; `checkout_started` is recorded there.
 */
export default function PlanChooser({
  monthly,
  annual,
  plan,
}: {
  monthly: number;
  annual: number;
  plan: 'trial' | 'free';
}) {
  const [cycle, setCycle] = useState<Cycle>('annual');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const free = monthsFree(monthly, annual);
  const p = t.upgrade.plan;

  async function handleSubscribe() {
    setState('loading');
    setErrorMessage('');
    track('upgrade_prompt_clicked', { placement: 'plan_page', plan, cycle });
    try {
      const res = await fetch('/api/billing/mercadopago/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycle }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return; // navigation starts, no state update needed
      }
      setErrorMessage(data.error || t.billing.subscribeError);
    } catch {
      setErrorMessage(t.billing.subscribeError);
    }
    setState('error');
  }

  const cards: {
    value: Cycle;
    name: string;
    price: string;
    unit: string;
    note: string | null;
  }[] = [
    { value: 'monthly', name: p.monthlyName, price: formatMx(monthly), unit: p.perMonth, note: null },
    {
      value: 'annual',
      name: p.annualName,
      price: formatMx(annual),
      unit: p.perYear,
      note: [
        p.monthlyEquivalent(formatMx(Math.ceil(annual / 12))),
        free > 0 ? p.monthsFree(free) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div
        role="radiogroup"
        aria-label={p.title}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}
      >
        {cards.map((c) => {
          const selected = cycle === c.value;
          return (
            <label
              key={c.value}
              className="flat-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                cursor: 'pointer',
                borderWidth: selected ? 3 : 1,
                padding: selected ? 'calc(1.25rem - 2px)' : '1.25rem',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <input
                  type="radio"
                  name="plan-cycle"
                  value={c.value}
                  checked={selected}
                  onChange={() => setCycle(c.value)}
                />
                {c.name}
              </span>
              <strong style={{ color: 'var(--text-main)', fontSize: '1.75rem', fontFamily: 'var(--font-serif)' }}>
                {c.price}
                <span style={{ fontSize: '1rem', fontWeight: 500 }}>{c.unit}</span>
              </strong>
              {c.note && (
                <span style={{ color: 'var(--green)', fontSize: '0.875rem', fontWeight: 600 }}>{c.note}</span>
              )}
            </label>
          );
        })}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
        {p.included.map((item) => (
          <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-main)' }}>
            <Check size={18} aria-hidden="true" color="var(--green)" />
            {item}
          </li>
        ))}
      </ul>

      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{p.qrAlwaysWorks}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubscribe}
          disabled={state === 'loading'}
          style={{ opacity: state === 'loading' ? 0.6 : 1, padding: '0.75rem 1.75rem' }}
        >
          {state === 'loading' ? t.billing.subscribing : t.billing.subscribeWithMercadoPago}
        </button>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {p.cancelAnytime} {p.annualRenews}
        </p>
        {state === 'error' && errorMessage && (
          <p role="alert" style={{ margin: 0, color: 'var(--red)', fontSize: '0.875rem' }}>
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
