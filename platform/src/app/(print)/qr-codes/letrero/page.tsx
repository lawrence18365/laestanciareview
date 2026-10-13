import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForRestaurant } from '@/lib/brands';
import { generateQrSvg } from '@/lib/qr';
import PrintButton from '../../guests/print/PrintButton';
import PrintTracker from './PrintTracker';

/**
 * Counter / table sign for the restaurant's own review QR. Letter size; it
 * scales cleanly onto half-letter. Copy is a plain ask: no incentive, and at
 * most 15 words besides the restaurant name (enforced by a test).
 *
 * Auth: the session's own restaurant only. There is no slug parameter, so one
 * restaurant can never print another's sign.
 */
export default async function LetreroPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const brand = getBrandForRestaurant(restaurant);
  const svg = await generateQrSvg(restaurant.slug);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PrintTracker />

      <div className="lt-toolbar">
        <a href="/qr-codes" className="lt-back">← Códigos QR</a>
        <PrintButton />
      </div>

      <div className="lt-bg">
        <div className="lt-sheet">
          <div className={`lt-logo-tile${brand.darkBg ? ' lt-logo-tile-dark' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo} alt="" className="lt-logo" />
          </div>
          <h1 className="lt-name">{restaurant.name}</h1>
          <p className="lt-ask">¿Cómo te fue? Déjanos tu reseña en Google</p>
          <div className="lt-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="lt-hint">Escanea con tu cámara</p>
        </div>
      </div>
    </>
  );
}

const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 0.4in; }
  body, html { background: white !important; margin: 0 !important; }
  .lt-toolbar { display: none !important; }
  .lt-bg { background: white !important; padding: 0 !important; min-height: 0 !important; }
  .lt-sheet {
    width: auto !important;
    height: 10.1in !important;
    box-shadow: none !important;
    margin: 0 !important;
  }
}

.lt-toolbar {
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
.lt-back {
  color: #aaa;
  font-size: 0.72rem;
  text-decoration: none;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-family: sans-serif;
}

.lt-bg {
  background: #f0ede8;
  min-height: 100vh;
  padding: 2rem 1rem;
}
/* One letter page: 7.7in x 10.1in inside the 0.4in margins. */
.lt-sheet {
  width: 7.7in;
  max-width: 100%;
  min-height: 10.1in;
  margin: 0 auto;
  background: #fff;
  border: 0.6pt solid #d97706;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35in;
  padding: 0.4in;
  box-sizing: border-box;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.lt-logo-tile {
  display: inline-flex;
  height: 1in;
  max-width: 4in;
  align-items: center;
  justify-content: center;
  padding: 0.08in;
  border-radius: 0.06in;
  background: #ffffff;
}
.lt-logo-tile-dark { background: #111111; }
.lt-logo { height: 100%; width: auto; max-width: 100%; object-fit: contain; display: block; }
.lt-name {
  margin: 0;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 38pt;
  font-weight: 700;
  line-height: 1.1;
  color: #111111;
}
.lt-ask {
  margin: 0;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 22pt;
  font-weight: 600;
  line-height: 1.25;
  color: #111111;
  max-width: 6in;
}
.lt-qr {
  width: 4.6in;
  height: 4.6in;
  max-width: 100%;
  background: #ffffff;
}
.lt-qr svg { width: 100%; height: 100%; display: block; }
.lt-hint {
  margin: 0;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 18pt;
  font-weight: 600;
  color: #d97706;
}

@media screen and (max-width: 900px) {
  .lt-sheet { width: 100%; min-height: 0; padding: 1.25rem; }
  .lt-name { font-size: 26pt; }
  .lt-ask { font-size: 16pt; }
}
`;
