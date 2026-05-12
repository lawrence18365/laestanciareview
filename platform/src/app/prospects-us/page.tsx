
import { Metadata } from 'next';
import * as fs from 'fs';
import * as path from 'path';

export const metadata: Metadata = {
  title: 'Key West Prospects — RateTap',
  robots: 'noindex',
};

interface Prospect {
  name: string;
  place_id: string;
  rating: number;
  user_ratings_total: number;
  phone?: string;
  website?: string;
  vicinity?: string;
}

function loadProspects(): Prospect[] {
  try {
    const filePath = path.join(process.cwd(), 'scripts', 'key-west-prospects.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Prospect[];
  } catch {
    return [];
  }
}

function makeWhatsAppUrl(p: Prospect): string | null {
  if (!p.phone) return null;
  // Ensure US country code
  const digits = p.phone.replace(/\D/g, '');
  const e164 = digits.startsWith('1') ? digits : `1${digits}`;

  const reviews = p.user_ratings_total.toLocaleString();
  const msg =
    `Hi, I'm the founder of RateTap. I work with restaurant groups — ` +
    `Grupo Estancia (12 locations in Mexico) just hit 4,997 Google reviews with 94% routing to 5-star. ` +
    `I noticed ${p.name} is at ${p.rating}★ with ${reviews} reviews. ` +
    `Want a free 2-week trial? QR code live same day, NFC cards ship when you convert. No card needed to start.`;

  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

function makeEmailUrl(p: Prospect): string | null {
  if (!p.website) return null;
  // Best effort: link to their website contact page
  return p.website;
}

export default function KeyWestProspectsPage() {
  const prospects = loadProspects();
  const withPhone = prospects.filter((p) => p.phone);
  const withoutPhone = prospects.filter((p) => !p.phone);

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '32px 16px 24px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '13px', color: '#FBBF24', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
          RateTap — Key West Cold Outreach
        </div>
        <h1 style={{ color: '#F8FAFC', fontSize: '24px', fontWeight: 700, margin: '0 0 4px' }}>
          Key West Hit List
        </h1>
        <p style={{ color: '#64748B', fontSize: '14px', margin: '0 0 8px' }}>
          Tap WhatsApp → message is pre-filled → hit send. 5 minutes for 50 restaurants.
        </p>
        <p style={{ color: '#475569', fontSize: '12px', margin: 0 }}>
          {prospects.length} prospects · {withPhone.length} with WhatsApp · {withoutPhone.length} website-only
        </p>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Message preview */}
        <div style={{
          background: 'rgba(37, 211, 102, 0.08)',
          border: '1px solid rgba(37, 211, 102, 0.2)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <div style={{ color: '#25D366', fontSize: '12px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
            Message Template
          </div>
          <p style={{ color: '#CBD5E1', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
            {`"Hi, I'm the founder of RateTap. I work with restaurant groups — Grupo Estancia (12 locations in Mexico) just hit 4,997 Google reviews with 94% routing to 5-star. I noticed `}
            <strong style={{ color: '#F8FAFC' }}>[Restaurant Name]</strong>
            {' is at '}
            <strong style={{ color: '#F8FAFC' }}>[X]★</strong>
            {' with '}
            <strong style={{ color: '#F8FAFC' }}>[N] reviews</strong>
            {`. Want a free 2-week trial? QR code live same day, NFC cards ship when you convert. No card needed to start."`}
          </p>
        </div>

        {/* WhatsApp prospects */}
        {withPhone.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px' }}>
              <span style={{ fontSize: '20px' }}>📱</span>
              <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 700 }}>
                WhatsApp ({withPhone.length})
              </span>
              <span style={{ color: '#64748B', fontSize: '13px' }}>— one tap to send</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {withPhone.map((p, i) => {
                const waUrl = makeWhatsAppUrl(p)!;
                const isHot = p.rating <= 4.0;
                return (
                  <div key={p.place_id} style={{
                    background: '#1E293B',
                    borderRadius: '12px',
                    padding: '16px',
                    border: isHot ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <div style={{ flex: 1, minWidth: 0, marginRight: '12px' }}>
                        <div style={{ color: '#F8FAFC', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                          {i + 1}. {p.name}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
                          <span style={{ color: isHot ? '#EF4444' : '#FBBF24', fontSize: '14px', fontWeight: 700 }}>
                            {p.rating}★
                          </span>
                          <span style={{ color: '#64748B', fontSize: '13px' }}>
                            {p.user_ratings_total.toLocaleString()} reviews
                          </span>
                          {p.vicinity && (
                            <span style={{ color: '#475569', fontSize: '11px' }}>
                              {p.vicinity}
                            </span>
                          )}
                        </div>
                      </div>
                      {isHot && (
                        <span style={{ fontSize: '10px', color: '#EF4444', fontWeight: 700, letterSpacing: '1px', flexShrink: 0 }}>
                          HIGH PAIN
                        </span>
                      )}
                    </div>

                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        background: '#25D366',
                        color: '#fff',
                        padding: '11px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                      Send WhatsApp
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Website-only prospects */}
        {withoutPhone.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px' }}>
              <span style={{ fontSize: '20px' }}>🌐</span>
              <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 700 }}>
                Website Contact ({withoutPhone.length})
              </span>
              <span style={{ color: '#64748B', fontSize: '13px' }}>— visit site, find contact email</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {withoutPhone.map((p, i) => (
                <div key={p.place_id} style={{
                  background: '#1E293B',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ color: '#F8FAFC', fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                      {withPhone.length + i + 1}. {p.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: '#FBBF24', fontSize: '14px', fontWeight: 700 }}>
                        {p.rating}★
                      </span>
                      <span style={{ color: '#64748B', fontSize: '13px' }}>
                        {p.user_ratings_total.toLocaleString()} reviews
                      </span>
                    </div>
                  </div>
                  {p.website && (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: 'rgba(255,255,255,0.07)',
                        color: '#94A3B8',
                        padding: '10px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Visit website →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {prospects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: '#475569' }}>
            <p>No prospects loaded yet.</p>
            <p style={{ fontSize: '13px' }}>Run: <code>npx tsx scripts/fetch-key-west-prospects.ts</code></p>
          </div>
        )}

        {/* Tips */}
        <div style={{
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '32px',
        }}>
          <div style={{ color: '#FBBF24', fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
            Tips
          </div>
          <ul style={{ color: '#CBD5E1', fontSize: '13px', lineHeight: 1.6, margin: 0, paddingLeft: '16px' }}>
            <li>Best time: Tue–Thu, 10am–12:30pm or 4:30–6pm EST</li>
            <li>Skip 1–4pm (lunch rush) and weekends</li>
            <li>Prioritize HIGH PAIN (red border) — they feel the problem most</li>
            <li>Message goes to whoever manages their WhatsApp — often the owner</li>
            <li>If they reply, they&apos;re serious — onboard them same day</li>
          </ul>
        </div>

        <div style={{ textAlign: 'center', padding: '16px 0 32px', color: '#475569', fontSize: '12px' }}>
          Key West, FL · Target: 3.5–4.3★ · Source: Google Places API
        </div>
      </div>
    </div>
  );
}
