import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuditTracker } from '@/components/audit/AuditTracker';

// ─── CONFIG ───
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.ratetapmx.com';
const WHATSAPP_NUMBER = process.env.PROSPECT_WHATSAPP || '523311479086';
const NEARBY_RADIUS = 3000;

// Cache audit pages for 24h to minimize API costs
const REVALIDATE = 86400;

// ─── Types ───
interface PlaceDetails {
  name: string;
  rating: number;
  user_ratings_total: number;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
}

interface NearbyPlace {
  place_id: string;
  name: string;
  rating: number;
  user_ratings_total: number;
}

// ─── Data fetching ───
async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!API_KEY) return null;
  const fields = 'name,rating,user_ratings_total,formatted_address,geometry';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&language=es&key=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE } });
  const data = await res.json();
  if (data.status !== 'OK' || !data.result) return null;
  return data.result;
}

async function getNearbyCompetitors(lat: number, lng: number, excludePlaceId: string): Promise<NearbyPlace[]> {
  if (!API_KEY) return [];
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${NEARBY_RADIUS}&type=restaurant&key=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE } });
  const data = await res.json();
  const results: NearbyPlace[] = (data.results || [])
    .filter((p: NearbyPlace & { place_id: string }) => p.place_id !== excludePlaceId && p.rating && p.user_ratings_total >= 10)
    .map((p: NearbyPlace & { place_id: string }) => ({
      place_id: p.place_id,
      name: p.name,
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
    }));
  return results.sort((a: NearbyPlace, b: NearbyPlace) => b.rating - a.rating);
}

// ─── Metadata ───
export async function generateMetadata(
  { params }: { params: Promise<{ placeId: string }> },
): Promise<Metadata> {
  const { placeId } = await params;
  const place = await getPlaceDetails(placeId);
  const title = place
    ? `Diagnóstico de Reputación — ${place.name}`
    : 'Diagnóstico de Reputación Digital';
  return {
    title,
    description: place
      ? `${place.name} tiene ${place.rating}★ en Google. Descubre cómo te comparas con tu competencia y cómo mejorar.`
      : 'Analiza tu reputación digital en Google y compárate con la competencia.',
    openGraph: { title, type: 'website' },
  };
}

// ─── Page ───
export default async function AuditPage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  const place = await getPlaceDetails(placeId);
  if (!place) notFound();

  const competitors = await getNearbyCompetitors(
    place.geometry.location.lat,
    place.geometry.location.lng,
    placeId,
  );

  // Stats
  const allRatings = [place.rating, ...competitors.map((c) => c.rating)];
  const areaAvg = allRatings.reduce((s, r) => s + r, 0) / allRatings.length;
  const ranking = [...competitors, { place_id: placeId, name: place.name, rating: place.rating, user_ratings_total: place.user_ratings_total }]
    .sort((a, b) => b.rating - a.rating || b.user_ratings_total - a.user_ratings_total);
  const myRank = ranking.findIndex((r) => r.place_id === placeId) + 1;
  const gap = areaAvg - place.rating;
  const topThreeAvg = ranking.slice(0, 3).reduce((s, r) => s + r.rating, 0) / Math.min(3, ranking.length);

  // WhatsApp CTA
  const ctaMsg = `Hola, vi el diagnóstico de ${place.name} en RateTap. Me interesa mejorar mi calificación de Google. ¿Cómo funciona?`;
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(ctaMsg)}`;

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <AuditTracker placeId={placeId} restaurantName={place.name} rating={place.rating} />
      {/* ─── Header ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        padding: '40px 20px 32px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(234,179,8,0.15)',
          color: '#FBBF24',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '2px',
          textTransform: 'uppercase' as const,
          padding: '6px 16px',
          borderRadius: '100px',
          marginBottom: '16px',
        }}>
          Diagnóstico Gratuito
        </div>
        <h1 style={{
          color: '#F8FAFC',
          fontSize: '28px',
          fontWeight: 700,
          margin: '0 0 8px',
          lineHeight: 1.2,
        }}>
          {place.name}
        </h1>
        <p style={{
          color: '#94A3B8',
          fontSize: '14px',
          margin: 0,
          maxWidth: '400px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          {place.formatted_address}
        </p>
      </div>

      {/* ─── Score Cards ─── */}
      <div style={{
        maxWidth: '480px',
        margin: '0 auto',
        padding: '24px 16px',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '24px',
        }}>
          {/* Your Rating */}
          <div style={{
            background: '#1E293B',
            border: `2px solid ${gap > 0.2 ? '#DC2626' : gap > 0 ? '#F59E0B' : '#10B981'}`,
            borderRadius: '16px',
            padding: '24px 16px',
            textAlign: 'center',
          }}>
            <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
              Tu calificación
            </div>
            <div style={{ fontSize: '48px', fontWeight: 800, color: gap > 0.2 ? '#EF4444' : gap > 0 ? '#F59E0B' : '#10B981', lineHeight: 1 }}>
              {place.rating}
            </div>
            <div style={{ color: '#64748B', fontSize: '13px', marginTop: '6px' }}>
              {place.user_ratings_total.toLocaleString()} reseñas
            </div>
          </div>

          {/* Area Average */}
          <div style={{
            background: '#1E293B',
            border: '2px solid #334155',
            borderRadius: '16px',
            padding: '24px 16px',
            textAlign: 'center',
          }}>
            <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
              Promedio zona
            </div>
            <div style={{ fontSize: '48px', fontWeight: 800, color: '#F8FAFC', lineHeight: 1 }}>
              {areaAvg.toFixed(1)}
            </div>
            <div style={{ color: '#64748B', fontSize: '13px', marginTop: '6px' }}>
              {ranking.length} restaurantes
            </div>
          </div>
        </div>

        {/* Gap Banner */}
        {gap > 0 && (
          <div style={{
            background: 'rgba(220,38,38,0.1)',
            border: '1px solid rgba(220,38,38,0.3)',
            borderRadius: '12px',
            padding: '16px',
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            <span style={{ color: '#FCA5A5', fontSize: '15px', fontWeight: 600 }}>
              Estás <span style={{ color: '#EF4444', fontWeight: 800, fontSize: '20px' }}>{gap.toFixed(1)} estrellas</span> debajo del promedio
            </span>
          </div>
        )}

        {/* ─── Visual Bar Comparison ─── */}
        <div style={{
          background: '#1E293B',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '16px' }}>
            Comparación visual
          </div>
          {[
            { label: place.name.length > 20 ? place.name.slice(0, 20) + '…' : place.name, value: place.rating, color: gap > 0.2 ? '#EF4444' : '#F59E0B' },
            { label: 'Promedio zona', value: areaAvg, color: '#64748B' },
            { label: 'Top 3 promedio', value: topThreeAvg, color: '#10B981' },
          ].map((bar) => (
            <div key={bar.label} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#CBD5E1', fontSize: '13px' }}>{bar.label}</span>
                <span style={{ color: bar.color, fontSize: '13px', fontWeight: 700 }}>{bar.value.toFixed(1)}★</span>
              </div>
              <div style={{ background: '#0F172A', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{
                  width: `${(bar.value / 5) * 100}%`,
                  height: '100%',
                  background: bar.color,
                  borderRadius: '4px',
                  transition: 'width 1s ease',
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* ─── Ranking Table ─── */}
        <div style={{
          background: '#1E293B',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '16px' }}>
            Ranking en tu zona — #{myRank} de {ranking.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {ranking.slice(0, 15).map((r, i) => {
              const isMe = r.place_id === placeId;
              return (
                <div
                  key={r.place_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: isMe ? 'rgba(234,179,8,0.1)' : 'transparent',
                    border: isMe ? '1px solid rgba(234,179,8,0.3)' : '1px solid transparent',
                  }}
                >
                  <span style={{
                    color: i < 3 ? '#FBBF24' : '#64748B',
                    fontWeight: 700,
                    fontSize: '13px',
                    width: '24px',
                    textAlign: 'right' as const,
                  }}>
                    #{i + 1}
                  </span>
                  <span style={{
                    flex: 1,
                    color: isMe ? '#FBBF24' : '#E2E8F0',
                    fontSize: '14px',
                    fontWeight: isMe ? 700 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                  }}>
                    {isMe ? `→ ${r.name}` : r.name}
                  </span>
                  <span style={{
                    color: isMe ? '#FBBF24' : '#94A3B8',
                    fontSize: '14px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap' as const,
                  }}>
                    {r.rating}★
                  </span>
                  <span style={{
                    color: '#64748B',
                    fontSize: '12px',
                    whiteSpace: 'nowrap' as const,
                  }}>
                    ({r.user_ratings_total})
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Impact Stats ─── */}
        <div style={{
          background: '#1E293B',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '16px' }}>
            ¿Por qué importa esto?
          </div>
          {[
            { stat: '90%', desc: 'de las personas eligen restaurante por su calificación de Google' },
            { stat: '+0.3★', desc: 'de mejora = hasta 15% más clientes nuevos' },
            { stat: '60 días', desc: 'es lo que toman nuestros restaurantes en subir su calificación' },
            { stat: '$0', desc: 'de inversión en publicidad — solo reseñas reales de tus clientes' },
          ].map((item) => (
            <div key={item.stat} style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
              marginBottom: '14px',
            }}>
              <span style={{
                color: '#10B981',
                fontSize: '18px',
                fontWeight: 800,
                minWidth: '60px',
              }}>
                {item.stat}
              </span>
              <span style={{ color: '#CBD5E1', fontSize: '14px', lineHeight: 1.4 }}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>

        {/* ─── How RateTap Works ─── */}
        <div style={{
          background: '#1E293B',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '32px',
        }}>
          <div style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: '16px' }}>
            ¿Cómo funciona RateTap?
          </div>
          {[
            { step: '1', title: 'Tu mesero entrega una tarjeta', desc: 'El cliente escanea un QR después de su visita' },
            { step: '2', title: 'Calificación inteligente', desc: 'Si es 4-5★ → va directo a Google. Si es 1-3★ → te llega como feedback privado' },
            { step: '3', title: 'Tu calificación sube', desc: 'Más reseñas positivas en Google, feedback negativo solo lo ves tú' },
          ].map((item) => (
            <div key={item.step} style={{
              display: 'flex',
              gap: '14px',
              alignItems: 'flex-start',
              marginBottom: '16px',
            }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(16,185,129,0.15)',
                color: '#10B981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {item.step}
              </div>
              <div>
                <div style={{ color: '#F8FAFC', fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>
                  {item.title}
                </div>
                <div style={{ color: '#94A3B8', fontSize: '13px', lineHeight: 1.4 }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ─── CTA ─── */}
        <a
          href={`${BASE_URL}/contacto`}
          style={{
            display: 'block',
            background: '#10B981',
            color: '#FFFFFF',
            textAlign: 'center',
            padding: '18px 24px',
            borderRadius: '14px',
            fontSize: '17px',
            fontWeight: 700,
            textDecoration: 'none',
            marginBottom: '12px',
            boxShadow: '0 4px 24px rgba(16,185,129,0.3)',
          }}
        >
          Empezar prueba gratis de 15 días →
        </a>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            background: 'transparent',
            color: '#25D366',
            textAlign: 'center',
            padding: '14px 24px',
            borderRadius: '14px',
            fontSize: '15px',
            fontWeight: 600,
            textDecoration: 'none',
            marginBottom: '8px',
            border: '1px solid rgba(37,211,102,0.4)',
          }}
        >
          Prefiero hablar por WhatsApp →
        </a>
        <p style={{
          textAlign: 'center',
          color: '#64748B',
          fontSize: '13px',
          margin: '0 0 40px',
        }}>
          Sin tarjeta de crédito · Cancela cuando quieras
        </p>

        {/* ─── Footer ─── */}
        <div style={{
          textAlign: 'center',
          padding: '24px 0 32px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ color: '#475569', fontSize: '12px' }}>
            Powered by{' '}
            <a href={BASE_URL} style={{ color: '#64748B', fontWeight: 600, textDecoration: 'none' }}>
              RateTap
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
