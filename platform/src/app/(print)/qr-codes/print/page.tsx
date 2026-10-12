import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import { getBrandForRestaurant } from '@/lib/brands';
import { cardUrlFor } from '@/lib/qr';
import PrintButton from '../../guests/print/PrintButton';

export default async function CardQrPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const brand = getBrandForRestaurant(restaurant);

  const staffList = await getStaffList(restaurant.id);
  let activeStaff = staffList.filter((s) => s.active);

  const { id } = await searchParams;
  if (id !== undefined) {
    const staffId = Number(id);
    const only = activeStaff.filter((s) => s.id === staffId);
    if (!Number.isInteger(staffId) || only.length === 0) notFound();
    activeStaff = only;
  }

  const cards = await Promise.all(
    activeStaff.map(async (s) => ({
      id: s.id,
      name: s.name,
      svg: await QRCode.toString(cardUrlFor(restaurant.slug, s.code), {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 1,
        color: { dark: '#111111', light: '#FFFFFF' },
      }),
    })),
  );

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="qt-toolbar">
        <a href="/qr-codes" className="qt-back">← Códigos QR</a>
        <PrintButton />
      </div>

      <div className="qt-bg">
        <div className="qt-sheet">
          {cards.length === 0 ? (
            <p className="qt-empty">No hay meseros activos.</p>
          ) : (
            <div className="qt-grid">
              {cards.map((c) => (
                <div key={c.id} className="qt-card">
                  <div className="qt-brand">
                    <div className={`qt-logo-tile${brand.darkBg ? ' qt-logo-tile-dark' : ''}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={brand.logo} alt="" className="qt-logo" />
                    </div>
                    <div className="qt-restaurant">{restaurant.name}</div>
                  </div>
                  <div className="qt-qr" dangerouslySetInnerHTML={{ __html: c.svg }} />
                  <div className="qt-name">{c.name}</div>
                  <div className="qt-hint">Escanee para calificar</div>
                  <div className="qt-footer">RATETAP</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const PRINT_CSS = `
/* ── Print / page setup ───────────────────────────────────── */
@media print {
  @page { size: letter; margin: 0.4in; }
  body, html { background: white !important; margin: 0 !important; }
  .qt-toolbar { display: none !important; }
  .qt-bg { background: white !important; padding: 0 !important; }
  .qt-sheet {
    width: auto !important;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
  }
}

/* ── Screen: toolbar ──────────────────────────────────────── */
.qt-toolbar {
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
.qt-back {
  color: #aaa;
  font-size: 0.72rem;
  text-decoration: none;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-family: sans-serif;
}

/* ── Screen: sheet on a warm page ─────────────────────────── */
.qt-bg {
  background: #f0ede8;
  min-height: 100vh;
  padding: 2rem 1rem;
}
.qt-sheet {
  width: 8.5in;
  max-width: 100%;
  margin: 0 auto;
  background: #fff;
  padding: 0.4in;
  box-shadow: 0 4px 32px rgba(0,0,0,0.12);
}

/* ── Cards ────────────────────────────────────────────────── */
.qt-grid {
  display: grid;
  grid-template-columns: repeat(2, 3.5in);
  gap: 0.2in;
  justify-content: center;
}
/* Portrait, mirroring the 9:16 card the waiter keeps on their phone
   (lib/qr-card.ts): gold rule, logo tile, name, QR, waiter, CTA, footer. */
.qt-card {
  width: 3.5in;
  height: 4.9in;
  background: #141414;
  break-inside: avoid;
  page-break-inside: avoid;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.22in 0.2in 0.16in;
  position: relative;
  overflow: hidden;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.qt-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 0.04in;
  background: #d97706;
}
.qt-card * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.qt-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.06in;
}
.qt-logo-tile {
  width: 0.85in;
  height: 0.85in;
  flex: 0 0 0.85in;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.08in;
  background: #ffffff;
  border: 1.5px solid #d97706;
}
.qt-logo-tile-dark {
  background: #111111;
}
.qt-logo {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}
.qt-restaurant {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 6.5pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #a3a3a3;
  text-align: center;
}
.qt-qr {
  width: 2.35in;
  height: 2.35in;
  flex: 0 0 2.35in;
  margin-top: 0.08in;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border-radius: 0.06in;
}
.qt-qr svg {
  /* 2.05in inside the 2.35in panel leaves a quiet zone for scanning. */
  width: 2.05in;
  height: 2.05in;
  display: block;
}
.qt-name {
  margin-top: 0.08in;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 20pt;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.1;
  overflow-wrap: anywhere;
  text-align: center;
}
.qt-hint {
  margin-top: 0.06in;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 10.5pt;
  color: #d97706;
  text-align: center;
}
.qt-footer {
  margin-top: auto;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 6pt;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: #5a5a5a;
  text-align: center;
}
.qt-empty {
  font-family: sans-serif;
  font-size: 0.85rem;
  color: #78716c;
  text-align: center;
  margin: 2rem 0;
}

/* ── Small screens (never applies to print) ───────────────── */
@media screen and (max-width: 900px) {
  .qt-sheet { width: 100%; padding: 1rem; }
  /* One centered column: a phone shows a single card, not a tiny one on a
     huge empty page. */
  .qt-grid { grid-template-columns: 1fr; justify-content: center; }
  .qt-card { width: 100%; max-width: 3.5in; margin: 0 auto; }
}
`;
