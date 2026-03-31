import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prospectos — RateTap',
  robots: 'noindex',
};

const WHATSAPP_NUMBER = '523311479086';
const BASE_URL = 'https://app.ratetapmx.com';

interface Prospect {
  name: string;
  placeId: string;
  rating: number;
  reviews: number;
  phone: string;
  tag: 'hot' | 'premium';
  note?: string;
}

const prospects: Prospect[] = [
  // Sweet spot — most pain, most likely to convert
  { name: 'El Braserío', placeId: 'ChIJtYGwFgC_K4QRrzcK2V5ekvk', rating: 4.2, reviews: 3020, phone: '524772150991', tag: 'hot', note: 'Steakhouse, competidor directo' },
  { name: 'Restaurant Martin', placeId: 'ChIJxVr-253AK4QRD6kqlPZWjtY', rating: 4.3, reviews: 2449, phone: '524777626373', tag: 'hot', note: 'Gran nombre local' },
  { name: 'Las Fabulosas Papas León', placeId: 'ChIJEbdGtq2_K4QRnFmJzJO05yw', rating: 4.3, reviews: 2505, phone: '524777709000', tag: 'hot' },
  { name: 'Lupillos', placeId: 'ChIJ15erbVC_K4QRp6TEVSFCVl4', rating: 4.3, reviews: 1238, phone: '524777176557', tag: 'hot', note: '3 sucursales — ganas 1, ganas 3' },
  { name: 'Don Carbón León', placeId: 'ChIJNRcD11G_K4QRlOGA4pHOn_g', rating: 4.0, reviews: 1656, phone: '524778304295', tag: 'hot', note: '0.2★ debajo del promedio' },
  { name: 'Mendozzinos Pizza', placeId: 'ChIJc2coYNm-K4QRa8zjE_XfiS4', rating: 3.8, reviews: 513, phone: '524774333585', tag: 'hot', note: '0.4★ debajo — MÁS URGENCIA' },
  { name: 'Factory Pizza Alitas & Bar', placeId: 'ChIJdxI8Zwu_K4QREiAJb9f578I', rating: 4.2, reviews: 1300, phone: '524777141515', tag: 'hot' },
  { name: 'Okuma Mariano Escobedo', placeId: 'ChIJwbiQs62_K4QRc_sAxxrZ8u8', rating: 4.3, reviews: 943, phone: '524773901175', tag: 'hot', note: 'Sushi, les importa su imagen' },
  { name: 'El Patito 4A Generación', placeId: 'ChIJBRq4c1C_K4QRdWh__kenbbw', rating: 4.1, reviews: 431, phone: '524777172966', tag: 'hot', note: '4a generación — orgullo familiar' },
  { name: 'Mariscos Gus', placeId: 'ChIJi7ZeDKfAK4QR4My4-5IHyPw', rating: 4.3, reviews: 569, phone: '524774708986', tag: 'hot' },
  { name: 'Green Place', placeId: 'ChIJF9bogK6_K4QRL323Kxbhl5M', rating: 4.2, reviews: 606, phone: '524773327070', tag: 'hot' },
  // Premium — already good, want to protect
  { name: 'Panteón Taurino', placeId: 'ChIJYw2tO3K_K4QR8uM9bpU1sHQ', rating: 4.5, reviews: 9121, phone: '524777134969', tag: 'premium', note: '9K+ reseñas, pez gordo' },
  { name: 'Estación Madero', placeId: 'ChIJsQ98bAi_K4QRNf4tHolU4hQ', rating: 4.5, reviews: 3618, phone: '524776986693', tag: 'premium' },
  { name: 'Pizzas Del Moral Buffet', placeId: 'ChIJNVatBEG_K4QRQxxy2AG0_NM', rating: 4.4, reviews: 2840, phone: '524777186382', tag: 'premium' },
];

function makeWhatsAppUrl(p: Prospect) {
  const msg = `Hola, buen día! Soy de RateTap. Trabajo con restaurantes en León como La Estancia, ayudándolos a subir su calificación de Google. Vi que ${p.name} tiene ${p.rating}★ — le preparé un diagnóstico gratuito de su reputación: ${BASE_URL}/audit/${p.placeId} ¿Le puedo platicar 10 minutos? Sin compromiso.`;
  return `https://wa.me/${p.phone}?text=${encodeURIComponent(msg)}`;
}

export default function ProspectsPage() {
  const hot = prospects.filter((p) => p.tag === 'hot');
  const premium = prospects.filter((p) => p.tag === 'premium');

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '32px 16px 24px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '13px', color: '#FBBF24', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
          RateTap — Prospectos León
        </div>
        <h1 style={{ color: '#F8FAFC', fontSize: '24px', fontWeight: 700, margin: '0 0 4px' }}>
          Memo&apos;s Hit List
        </h1>
        <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>
          Toca WhatsApp → se abre el mensaje → manda. Así de fácil.
        </p>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Hot Prospects */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '12px', padding: '0 4px',
          }}>
            <span style={{ fontSize: '20px' }}>🔥</span>
            <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 700 }}>
              Sweet Spot ({hot.length})
            </span>
            <span style={{ color: '#64748B', fontSize: '13px' }}>— más dolor, más probable que compren</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {hot.map((p, i) => (
              <div key={p.placeId} style={{
                background: '#1E293B',
                borderRadius: '12px',
                padding: '16px',
                border: p.rating <= 4.0 ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 600 }}>
                      {i + 1}. {p.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                      <span style={{
                        color: p.rating <= 4.0 ? '#EF4444' : '#FBBF24',
                        fontSize: '14px', fontWeight: 700,
                      }}>
                        {p.rating}★
                      </span>
                      <span style={{ color: '#64748B', fontSize: '13px' }}>
                        {p.reviews.toLocaleString()} reseñas
                      </span>
                    </div>
                    {p.note && (
                      <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>
                        {p.note}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <a
                    href={makeWhatsAppUrl(p)}
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
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
              </div>
            ))}
          </div>
        </div>

        {/* Premium */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '12px', padding: '0 4px',
          }}>
            <span style={{ fontSize: '20px' }}>💎</span>
            <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 700 }}>
              Premium ({premium.length})
            </span>
            <span style={{ color: '#64748B', fontSize: '13px' }}>— ya buenos, quieren proteger su rating</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {premium.map((p, i) => (
              <div key={p.placeId} style={{
                background: '#1E293B',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid rgba(251,191,36,0.15)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 600 }}>
                      {p.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                      <span style={{ color: '#10B981', fontSize: '14px', fontWeight: 700 }}>
                        {p.rating}★
                      </span>
                      <span style={{ color: '#64748B', fontSize: '13px' }}>
                        {p.reviews.toLocaleString()} reseñas
                      </span>
                    </div>
                    {p.note && (
                      <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>
                        {p.note}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <a
                    href={makeWhatsAppUrl(p)}
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
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
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div style={{
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '32px',
        }}>
          <div style={{ color: '#FBBF24', fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
            Tips para Memo
          </div>
          <ul style={{ color: '#CBD5E1', fontSize: '13px', lineHeight: 1.6, margin: 0, paddingLeft: '16px' }}>
            <li>El mensaje ya viene llenado — solo dale send</li>
            <li>Si no tiene WhatsApp el número, búscalos en su Facebook</li>
            <li>Mejor hora: martes-jueves, 10am-12:30pm o 4:30-6pm</li>
            <li>Nunca vayas entre 1-4pm (hora de comida) ni fines de semana</li>
            <li>Menciona La Estancia como caso de éxito — es tu arma secreta</li>
            <li>Ofrece 2 semanas gratis, configúralo tú en el momento</li>
          </ul>
        </div>

        <div style={{ textAlign: 'center', padding: '16px 0 32px', color: '#475569', fontSize: '12px' }}>
          Promedio zona León: 4.23★ · 187 restaurantes escaneados · Datos de Google
        </div>
      </div>
    </div>
  );
}
