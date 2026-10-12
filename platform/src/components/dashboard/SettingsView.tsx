'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import GooglePlaceSearch, {
  GOOGLE_PLACES_BROWSER_KEY,
  type PlaceSelection,
} from '@/components/GooglePlaceSearch';
import {
  derivedGoogleReviewUrl,
  isDerivedGoogleReviewUrl,
} from '@/lib/google-review';

interface BillingInfo {
  provider: string | null;
  status: string;
  mercadopagoStatus: string | null;
  nextPaymentDate: string | null;
  billingStartsAt: string | null;
  billingStarted: boolean;
  priceBreakdown: {
    base: number;
    processingCharge: number;
    total: number;
  };
}

interface Props {
  settings: {
    name: string;
    slug: string;
    googleReviewUrl: string;
    googlePlaceId: string;
    /** URL of the restaurant's own uploaded logo, or null when it has none. */
    logoUrl: string | null;
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

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: 'transparent',
  color: 'var(--text-main)',
  border: '1px solid var(--border-dark)',
};

/* ── Logo upload ──
 *
 * The image is resized and re-encoded in the browser before it is sent, so the
 * row stays small and the server only has to validate what it receives:
 *   - longest side <= 512 px (a logo is shown at 44–160 px on every surface),
 *   - PNG when the source has transparency, JPEG q=0.85 otherwise,
 *   - <= 200 KB.
 * This is deliberately the only place that touches logoDataUrl on the client:
 * everywhere else links to /api/logo/[slug], so the (up to 280 KB) data URL is
 * never part of a props object.
 */
const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_SIDE = 512;
const LOGO_MAX_IMAGE_BYTES = 200 * 1024;

/** Bytes a data URL stands for (base64 is 4 chars per 3 bytes, minus padding). */
function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Any pixel that is not fully opaque — i.e. the source needs an alpha channel. */
function hasTransparency(image: ImageData): boolean {
  const { data } = image;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

/** Throws 'too-big' or 'unreadable'; both are shown to the user. */
async function encodeLogoFile(file: File): Promise<string> {
  if (!LOGO_ACCEPTED_TYPES.includes(file.type)) throw new Error('unreadable');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('unreadable');
  }

  try {
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('unreadable');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL(
      hasTransparency(ctx.getImageData(0, 0, width, height)) ? 'image/png' : 'image/jpeg',
      0.85,
    );
    if (dataUrlByteLength(dataUrl) > LOGO_MAX_IMAGE_BYTES) throw new Error('too-big');
    return dataUrl;
  } finally {
    bitmap.close?.();
  }
}

export default function SettingsView({ settings, billing }: Props) {
  const [googleReviewUrl, setGoogleReviewUrl] = useState(settings.googleReviewUrl);
  const [googlePlaceId, setGooglePlaceId] = useState(settings.googlePlaceId);
  const [placeQuery, setPlaceQuery] = useState(settings.name);
  const [googleThreshold, setGoogleThreshold] = useState(settings.googleThreshold);
  const [managerEmail, setManagerEmail] = useState(settings.managerEmail);
  const [managerPhone, setManagerPhone] = useState(settings.managerPhone);
  const [alertPreference, setAlertPreference] = useState(settings.alertPreference);
  const [smsAlerts, setSmsAlerts] = useState(settings.smsAlerts);
  const [whatsappAlerts, setWhatsappAlerts] = useState(settings.whatsappAlerts);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /** Shown logo: the saved one, or the freshly picked file before it is saved. */
  const [logoPreview, setLogoPreview] = useState<string | null>(settings.logoUrl);
  /** A picked-but-unsaved logo. Null means "nothing to save". */
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  /**
   * A Google place was picked. Saved immediately (not with the general form):
   * it is the one setting whose effect — guests reaching the right review
   * page — matters more than the rest of the form being complete.
   *
   * The review URL is replaced only when it is ours to replace: empty, or a
   * writereview URL we derived from an earlier place ID. A URL the restaurant
   * typed (g.page/…, maps.app.goo.gl/…) is never overwritten.
   */
  async function handlePlaceSelected(place: PlaceSelection) {
    if (!place.placeId) return;
    const derivedUrl = derivedGoogleReviewUrl(place.placeId);
    const replaceReviewUrl = !googleReviewUrl.trim() || isDerivedGoogleReviewUrl(googleReviewUrl);

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googlePlaceId: place.placeId,
          ...(replaceReviewUrl ? { googleReviewUrl: derivedUrl } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t.login.somethingWrong);
      }
      setGooglePlaceId(place.placeId);
      if (replaceReviewUrl) setGoogleReviewUrl(derivedUrl);
      if (place.name) setPlaceQuery(place.name);
      setMessage(t.settings.googlePlaceSaved);
      setMessageType('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.login.somethingWrong);
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  }

  /** Scale + re-encode locally; nothing is uploaded until "Guardar logo". */
  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the value so re-picking the same file after a rejection works.
    e.target.value = '';
    if (!file) return;

    setLogoError('');
    try {
      const dataUrl = await encodeLogoFile(file);
      setLogoDataUrl(dataUrl);
      setLogoPreview(dataUrl);
    } catch (err) {
      setLogoError(
        err instanceof Error && err.message === 'too-big'
          ? t.settings.logoTooBig
          : t.settings.logoUnreadable,
      );
    }
  }

  /** Send the picked logo (or `null` to remove it) and adopt the served URL. */
  async function handleSaveLogo(next: string | null) {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoDataUrl: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        logoUrl?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t.login.somethingWrong);

      setLogoDataUrl(null);
      setLogoPreview(data.logoUrl ?? null);
      setMessage(t.settings.logoSaved);
      setMessageType('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.login.somethingWrong);
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  }

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

      {/* Logo */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.logo}</h2>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              width: 96,
              height: 96,
              flexShrink: 0,
              border: '1px solid var(--border-dark)',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt={settings.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }}
              />
            ) : (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center', padding: '0.5rem' }}>
                {t.settings.logoNone}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '1 1 220px', minWidth: 0 }}>
            <label style={labelStyle} htmlFor="logoFile">
              {t.settings.logoUpload}
            </label>
            <input
              id="logoFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoChange}
              style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}
            />
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              {t.settings.logoHint}
            </p>

            {logoError && (
              <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>
                {logoError}
              </p>
            )}

            {logoDataUrl ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveLogo(logoDataUrl)}
                  style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? t.settings.saving : t.settings.logoSave}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setLogoDataUrl(null);
                    setLogoPreview(settings.logoUrl);
                    setLogoError('');
                  }}
                  style={btnSecondary}
                >
                  {t.settings.logoCancel}
                </button>
              </div>
            ) : logoPreview ? (
              <div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveLogo(null)}
                  style={{ ...btnSecondary, opacity: saving ? 0.6 : 1 }}
                >
                  {t.settings.logoRemove}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section style={card}>
        <h2 style={sectionTitle}>{t.settings.generalSettings}</h2>

        {/* Google profile. Saves on selection, so it sits outside the form
            below — Enter inside an autocomplete input must not submit a
            half-filled form. Rendered only when the Places key is configured;
            the free-text URL field below always works. */}
        {GOOGLE_PLACES_BROWSER_KEY && (
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle} htmlFor="googlePlace">
              {t.settings.googlePlace}
            </label>
            <GooglePlaceSearch
              inputId="googlePlace"
              value={placeQuery}
              onChange={setPlaceQuery}
              onSelect={handlePlaceSelected}
              placeholder={t.settings.googlePlacePlaceholder}
              style={inputStyle}
            />
            <p
              style={{
                margin: '0.3rem 0 0',
                fontSize: '0.8rem',
                color: googlePlaceId ? 'var(--green)' : 'var(--text-dim)',
              }}
            >
              {googlePlaceId ? `✓ ${t.settings.googlePlaceConnected}` : t.settings.googlePlaceHint}
            </p>
          </div>
        )}

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
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                {t.settings.googleReviewUrlHint}
              </p>
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

const mxnFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const nextPayment = billing.nextPaymentDate
    ? formatDate(billing.nextPaymentDate)
    : null;

  const billingStarts = billing.billingStartsAt
    ? formatDate(billing.billingStartsAt)
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

      <div
        style={{
          borderTop: '1px solid var(--border-dark)',
          borderBottom: '1px solid var(--border-dark)',
          padding: '0.9rem 0',
          marginBottom: '1rem',
        }}
      >
        <span style={{ ...labelStyle, marginBottom: '0.65rem' }}>
          {t.billing.priceBreakdown}
        </span>
        <div style={{ display: 'grid', gap: '0.55rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {t.billing.planName}
            </span>
            <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
              {mxnFormatter.format(billing.priceBreakdown.base)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {t.billing.serviceCharge}
            </span>
            <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
              {mxnFormatter.format(billing.priceBreakdown.processingCharge)}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              paddingTop: '0.65rem',
              borderTop: '1px solid var(--border-dark)',
            }}
          >
            <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
              {t.billing.monthlyTotal}
            </strong>
            <strong style={{ color: 'var(--text-main)', fontSize: '1.15rem' }}>
              {mxnFormatter.format(billing.priceBreakdown.total)} {t.billing.perMonth}
            </strong>
          </div>
        </div>
      </div>

      {!billing.billingStarted && billingStarts && (
        <p
          style={{
            margin: '0 0 1rem',
            padding: '0.75rem 1rem',
            borderLeft: '3px solid var(--text-main)',
            background: 'var(--bg-base)',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}
        >
          {t.billing.billingStartsNote(billingStarts)}
        </p>
      )}

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
