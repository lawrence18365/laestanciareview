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
      code: s.code,
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
                  <div className="qt-qr" dangerouslySetInnerHTML={{ __html: c.svg }} />
                  <div className="qt-info">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={brand.logo} alt="" className="qt-logo" />
                    <div className="qt-name">{c.name}</div>
                    <div className="qt-hint">Escanee para calificar</div>
                    <div className="qt-code">{c.code}</div>
                  </div>
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
  gap: 0.25in;
  justify-content: center;
}
.qt-card {
  width: 3.5in;
  height: 2.4in;
  border: 1px dashed #bbb;
  break-inside: avoid;
  page-break-inside: avoid;
  display: flex;
  align-items: center;
  gap: 0.16in;
  padding: 0.14in;
  overflow: hidden;
}
.qt-qr {
  width: 1.9in;
  height: 1.9in;
  flex: 0 0 1.9in;
}
.qt-qr svg {
  width: 100%;
  height: 100%;
  display: block;
}
.qt-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.06in;
}
.qt-logo {
  height: 0.45in;
  width: auto;
  max-width: 100%;
  object-fit: contain;
}
.qt-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1c1917;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.qt-hint {
  font-family: sans-serif;
  font-size: 9pt;
  color: #555;
}
.qt-code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 8pt;
  color: #888;
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
  .qt-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .qt-card { width: 100%; }
}
`;
