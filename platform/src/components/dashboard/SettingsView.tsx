'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

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
  };
}

const card: React.CSSProperties = {
  background: 'var(--warm-white)',
  borderRadius: 10,
  padding: '1.5rem',
  boxShadow: 'var(--shadow-sm)',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-cormorant), serif',
  fontSize: '1.3rem',
  fontWeight: 600,
  marginTop: 0,
  marginBottom: '1rem',
  color: 'var(--espresso)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--stone-700)',
  marginBottom: '0.3rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--stone-300)',
  fontSize: '0.9rem',
  background: 'var(--warm-white)',
  color: 'var(--espresso)',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--espresso)',
  color: 'var(--warm-white)',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
  transition: 'opacity 0.2s',
};

export default function SettingsView({ settings }: Props) {
  const [googleReviewUrl, setGoogleReviewUrl] = useState(settings.googleReviewUrl);
  const [googleThreshold, setGoogleThreshold] = useState(settings.googleThreshold);
  const [managerEmail, setManagerEmail] = useState(settings.managerEmail);
  const [managerPhone, setManagerPhone] = useState(settings.managerPhone);
  const [alertPreference, setAlertPreference] = useState(settings.alertPreference);
  const [smsAlerts, setSmsAlerts] = useState(settings.smsAlerts);
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
        body: JSON.stringify({ googleReviewUrl, googleThreshold, managerEmail, managerPhone, alertPreference, smsAlerts }),
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
        body: JSON.stringify({ newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.login.somethingWrong);
      }

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 640 }}>
      {/* Message banner */}
      {message && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 500,
            background: messageType === 'success' ? 'var(--success-light)' : '#fef2f2',
            color: messageType === 'success' ? 'var(--success)' : '#dc2626',
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
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>{settings.name}</p>
          </div>
          <div>
            <span style={{ ...labelStyle, marginBottom: '0.15rem' }}>{t.settings.slug}</span>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                color: 'var(--stone-500)',
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
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--stone-400)' }}>
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
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {t.settings.starAndAbove(n)}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.8rem', color: 'var(--stone-400)' }}>
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
                style={{ ...inputStyle, width: 'auto' }}
              >
                <option value="all">{t.settings.allFeedback}</option>
                <option value="low">{t.settings.lowRatingsOnly}</option>
                <option value="threshold">{t.settings.belowGoogleThreshold}</option>
                <option value="off">{t.settings.off}</option>
              </select>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--stone-400)' }}>
                {t.settings.alertHint}
              </p>
            </div>

            <div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={smsAlerts}
                  onChange={(e) => setSmsAlerts(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--espresso)', cursor: 'pointer' }}
                />
                <span style={{ textTransform: 'none', fontSize: '0.9rem', fontWeight: 500, color: 'var(--espresso)' }}>
                  {t.settings.enableSmsAlerts}
                </span>
              </label>
              <p style={{ margin: '0.3rem 0 0 1.6rem', fontSize: '0.8rem', color: 'var(--stone-400)' }}>
                {t.settings.smsHint}
              </p>
            </div>

            <div style={{ paddingTop: '0.5rem' }}>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? t.settings.saving : t.settings.saveSettings}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Change Password */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.changePassword}</h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
