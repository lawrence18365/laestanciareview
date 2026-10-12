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
                  </div>
                  <div className="qt-qr" dangerouslySetInnerHTML={{ __html: c.svg }} />
                  <div className="qt-label">Le atendió</div>
                  <div className={`qt-name${c.name.length > 14 ? ' qt-name-long' : ''}`}>{c.name}</div>
                  <svg className="qt-stars" aria-hidden="true" viewBox="0 0 120 24" fill="#D97706">
                    <path d={STAR_PATH} />
                    <path d={STAR_PATH} transform="translate(24 0)" />
                    <path d={STAR_PATH} transform="translate(48 0)" />
                    <path d={STAR_PATH} transform="translate(72 0)" />
                    <path d={STAR_PATH} transform="translate(96 0)" />
                  </svg>
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

/**
 * One 24x24 five-point star. The row repeats it five times, 24 units apart,
 * mirroring the vector stars on the phone card (lib/qr-card.ts).
 */
const STAR_PATH =
  'M12 1L14.47 8.6L22.46 8.6L15.99 13.3L18.47 20.9L12 16.2L5.53 20.9L8.01 13.3L1.54 8.6L9.53 8.6Z';

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
   (lib/qr-card.ts): gold rule, logo badge, QR, label, waiter, stars, CTA, footer. */
.qt-card {
  width: 3.5in;
  height: 4.9in;
  background: radial-gradient(ellipse at 50% 40%, #232323 0%, #0d0d0d 75%);
  break-inside: avoid;
  page-break-inside: avoid;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  /* The label costs ~0.24in, so the chrome above/below it is tightened to keep
     the 2.45in QR and leave the footer visible space inside the inset frame. */
  padding: 0.15in 0.2in 0.15in;
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
/* Gold hairline frame, inset from every edge — the phone card's inset stroke. */
.qt-card::after {
  content: '';
  position: absolute;
  inset: 0.1in;
  border: 0.6pt solid rgba(217,119,6,0.55);
  pointer-events: none;
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
/* The badge hugs the logo's aspect ratio instead of boxing it in: fixed
   height, width from the image, no border. */
.qt-logo-tile {
  display: inline-flex;
  height: 0.7in;
  max-width: 2.4in;
  align-items: center;
  justify-content: center;
  padding: 0.05in;
  border-radius: 0.05in;
  border: none;
  background: #ffffff;
}
.qt-logo-tile-dark {
  background: #111111;
}
.qt-logo {
  height: 100%;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  display: block;
}
.qt-qr {
  width: 2.45in;
  height: 2.45in;
  flex: 0 0 2.45in;
  margin-top: 0.1in;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border-radius: 0.06in;
}
.qt-qr svg {
  /* 2.15in inside the 2.45in panel leaves a quiet zone for scanning. */
  width: 2.15in;
  height: 2.15in;
  display: block;
}
/* "LE ATENDIÓ" — the label the phone card draws above the name. */
.qt-label {
  margin-top: 0.1in;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 6.5pt;
  letter-spacing: 0.22em;
  font-weight: 600;
  text-transform: uppercase;
  color: #d97706;
  opacity: 0.75;
  text-align: center;
}
.qt-name {
  margin-top: 0.02in;
  /* Fixed line box: a long name (15pt) sits at the same height as a short one. */
  height: 0.34in;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 20pt;
  font-weight: 700;
  color: #ffffff;
  line-height: 0.34in;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}
.qt-name-long {
  font-size: 15pt;
}
.qt-stars {
  height: 0.21in;
  width: auto;
  margin-top: 0.04in;
  display: block;
}
.qt-hint {
  margin-top: 0.05in;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13pt;
  font-weight: 600;
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
