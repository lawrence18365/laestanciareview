'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';

interface BillingInfo {
  provider: string | null;
  status: string;
  mercadopagoStatus: string | null;
  nextPaymentDate: string | null;
}

interface Props {
  settings: {
    name: string;
    slug: string;
    googleReviewUrl: string;
    googleThreshold: number;
    managerEmail: string;
    managerPhone: string;
    alertPreference: string;
    smsAlerts: boolean;
    whatsappAlerts: boolean;
  };
  billing: BillingInfo;
}

const card: React.CSSProperties = {
  background: 'var(--panel-bg)',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  padding: '1.5rem',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1.1rem',
  fontWeight: 600,
  color: 'var(--text-main)',
  margin: 0,
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: '0.35rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  fontSize: '0.9rem',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
  fontFamily: 'var(--font-sans)',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  border: 'none',
  background: 'var(--text-main)',
  color: 'var(--panel-bg)',
  fontWeight: 700,
  fontSize: '0.7rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 0,
};

export default function SettingsView({ settings, billing }: Props) {
  const [googleReviewUrl, setGoogleReviewUrl] = useState(settings.googleReviewUrl);
  const [googleThreshold, setGoogleThreshold] = useState(settings.googleThreshold);
  const [managerEmail, setManagerEmail] = useState(settings.managerEmail);
  const [managerPhone, setManagerPhone] = useState(settings.managerPhone);
  const [alertPreference, setAlertPreference] = useState(settings.alertPreference);
  const [smsAlerts, setSmsAlerts] = useState(settings.smsAlerts);
  const [whatsappAlerts, setWhatsappAlerts] = useState(settings.whatsappAlerts);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const res = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleReviewUrl, googleThreshold, managerEmail, managerPhone, alertPreference, smsAlerts, whatsappAlerts }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.login.somethingWrong);
      }

      setMessage(t.settings.settingsSaved);
      setMessageType('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.login.somethingWrong);
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      setMessage(t.settings.currentPasswordRequired);
      setMessageType('error');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage(t.settings.passwordsDoNotMatch);
      setMessageType('error');
      return;
    }
    if (newPassword.length < 8) {
      setMessage(t.settings.passwordTooShort);
      setMessageType('error');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const res = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.login.somethingWrong);
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(t.settings.passwordUpdated);
      setMessageType('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.login.somethingWrong);
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 640, width: '100%', margin: '0 auto', padding: '1.5rem' }}>
      {/* Message banner */}
      {message && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 0,
            fontSize: '0.85rem',
            fontWeight: 500,
            border: messageType === 'success' ? '1px solid var(--green)' : '1px solid var(--red)',
            background: messageType === 'success' ? 'var(--green-light)' : 'var(--red-light)',
            color: messageType === 'success' ? 'var(--green)' : 'var(--red)',
          }}
        >
          {message}
        </div>
      )}

      {/* Restaurant Info (read-only) */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.restaurant}</h2>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.settings.name}</span>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500, color: 'var(--text-main)' }}>{settings.name}</p>
          </div>
          <div>
            <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.settings.slug}</span>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              {settings.slug}
            </p>
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.generalSettings}</h2>
        <form onSubmit={handleSaveGeneral}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={labelStyle} htmlFor="managerEmail">
                {t.settings.managerEmail}
              </label>
              <input
                id="managerEmail"
                type="email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="gm@restaurant.com"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="managerPhone">
                {t.settings.managerPhone}
              </label>
              <input
                id="managerPhone"
                type="tel"
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                style={inputStyle}
              />
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {t.settings.phoneHint}
              </p>
            </div>

            <div>
              <label style={labelStyle} htmlFor="googleReviewUrl">
                {t.settings.googleReviewUrl}
              </label>
              <input
                id="googleReviewUrl"
                type="url"
                value={googleReviewUrl}
                onChange={(e) => setGoogleReviewUrl(e.target.value)}
                placeholder="https://g.page/r/..."
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="googleThreshold">
                {t.settings.googleRedirectThreshold}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <select
                  id="googleThreshold"
                  value={googleThreshold}
                  onChange={(e) => setGoogleThreshold(Number(e.target.value))}
                  style={{ ...inputStyle, width: 'auto', maxWidth: '100%' }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {t.settings.starAndBelow(n)}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  {t.settings.thresholdHint}
                </span>
              </div>
            </div>

            <div>
              <label style={labelStyle} htmlFor="alertPreference">
                {t.settings.alertTrigger}
              </label>
              <select
                id="alertPreference"
                value={alertPreference}
                onChange={(e) => setAlertPreference(e.target.value)}
                style={{ ...inputStyle, width: 'auto', maxWidth: '100%' }}
              >
                <option value="all">{t.settings.allFeedback}</option>
                <option value="low">{t.settings.lowRatingsOnly}</option>
                <option value="threshold">{t.settings.belowGoogleThreshold}</option>
                <option value="off">{t.settings.off}</option>
              </select>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {t.settings.alertHint}
              </p>
            </div>

            <div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={smsAlerts}
                  onChange={(e) => setSmsAlerts(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--text-main)', cursor: 'pointer' }}
                />
                <span style={{ textTransform: 'none', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>
                  {t.settings.enableSmsAlerts}
                </span>
              </label>
              <p style={{ margin: '0.3rem 0 0 1.6rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {t.settings.smsHint}
              </p>
            </div>

            <div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={whatsappAlerts}
                  onChange={(e) => setWhatsappAlerts(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#25D366', cursor: 'pointer' }}
                />
                <span style={{ textTransform: 'none', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>
                  {t.settings.enableWhatsappAlerts}
                </span>
              </label>
              <p style={{ margin: '0.3rem 0 0 1.6rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {t.settings.whatsappHint}
              </p>
              {whatsappAlerts && (
                <div style={{
                  marginTop: '0.75rem',
                  marginLeft: '1.6rem',
                  padding: '1rem 1.25rem',
                  background: 'rgba(37, 211, 102, 0.06)',
                  borderLeft: '3px solid #25D366',
                }}>
                  <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {t.settings.whatsappActivateTitle}
                  </p>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {t.settings.whatsappActivateStep1}<br />
                    {t.settings.whatsappActivateStep2(
                      process.env.NEXT_PUBLIC_TWILIO_SANDBOX_CODE || 'join ***'
                    )}<br />
                    {t.settings.whatsappActivateStep3}
                  </p>
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#25D366', fontWeight: 500 }}>
                    {t.settings.whatsappActivated}
                  </p>
                </div>
              )}
            </div>

            <div style={{ paddingTop: '0.5rem' }}>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? t.settings.saving : t.settings.saveSettings}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Billing */}
      <BillingCard billing={billing} />

      {/* Change Password */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.changePassword}</h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={labelStyle} htmlFor="currentPassword">
                {t.settings.currentPassword}
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t.settings.enterCurrentPassword}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="newPassword">
                {t.settings.newPassword}
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t.settings.minChars}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="confirmPassword">
                {t.settings.confirmPassword}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t.settings.repeatPassword}
                style={inputStyle}
              />
            </div>

            <div style={{ paddingTop: '0.5rem' }}>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? t.settings.updating : t.settings.updatePassword}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function billingStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return t.billing.statusActive;
    case 'trialing':
      return t.billing.statusTrialing;
    case 'past_due':
      return t.billing.statusPastDue;
    case 'canceled':
      return t.billing.statusCanceled;
    default:
      return status;
  }
}

function BillingCard({ billing }: { billing: BillingInfo }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingNote, setPendingNote] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('billing') === 'mercadopago') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Read client-only URL state after hydration.
      setPendingNote(true);
    }
  }, []);

  // Manual/Stripe-active customers never see it; pilot/trialing restaurants and pending/paused Mercado Pago ones do.
  const showSubscribeButton =
    billing.mercadopagoStatus !== 'authorized' &&
    billing.provider !== 'stripe' &&
    !(billing.status === 'active' && billing.provider !== 'mercadopago');

  async function handleSubscribe() {
    setState('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/billing/mercadopago/subscribe', { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return; // navigation starts — no state update needed
      }
      setErrorMessage(data.error || t.billing.subscribeError);
    } catch {
      setErrorMessage(t.billing.subscribeError);
    }
    setState('error');
  }

  const providerLabel =
    billing.provider === 'stripe'
      ? t.billing.providerStripe
      : billing.provider === 'mercadopago'
        ? t.billing.providerMercadoPago
        : t.billing.providerNone;

  const nextPayment = billing.nextPaymentDate
    ? new Date(billing.nextPaymentDate).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <section style={card}>
      <h2 style={sectionTitle}>{t.billing.title}</h2>

      {pendingNote && (
        <p
          style={{
            margin: '0 0 1rem',
            padding: '0.6rem 1rem',
            fontSize: '0.85rem',
            fontWeight: 500,
            border: '1px solid var(--green)',
            background: 'var(--green-light)',
            color: 'var(--green)',
          }}
        >
          {t.billing.mercadoPagoPendingNote}
        </p>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.billing.currentStatus}</span>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500, color: 'var(--text-main)' }}>
            {billingStatusLabel(billing.status)}
          </p>
        </div>
        <div>
          <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.billing.provider}</span>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{providerLabel}</p>
        </div>
        {nextPayment && (
          <div>
            <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.billing.nextPaymentDate}</span>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{nextPayment}</p>
          </div>
        )}
      </div>

      {showSubscribeButton && (
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={state === 'loading'}
          style={{ ...btnPrimary, opacity: state === 'loading' ? 0.6 : 1 }}
        >
          {state === 'loading' ? t.billing.subscribing : t.billing.subscribeWithMercadoPago}
        </button>
      )}

      {state === 'error' && errorMessage && (
        <p role="alert" style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: 'var(--red)' }}>
          {errorMessage}
        </p>
      )}
    </section>
  );
}
