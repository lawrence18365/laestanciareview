/**
 * The waiter's digital card: a 9:16 PNG the waiter keeps in their phone
 * favourites and shows to a guest, instead of handing over an NFC card.
 *
 * Client-only — it builds a canvas and encodes the QR in the browser, so the
 * `qrcode` dependency is imported lazily on first use.
 */

export interface WaiterCardOptions {
  /** Exact URL of the waiter's card (see cardUrlFor). */
  url: string;
  waiterName: string;
  restaurantName: string;
  /** Brand logo path, e.g. /logos/estancia.jpg. */
  logoSrc: string;
  /** Whether the logo reads better on a dark tile. */
  logoDarkBg: boolean;
}

const CARD_W = 1080;
const CARD_H = 1920;

const GOLD = '#D97706';
// Background: a soft radial wash, warm at the centre and near-black at the edges.
const BG_CENTER = '#232323';
const BG_EDGE = '#0D0D0D';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
// Playfair is the app's display serif (globals.css --font-serif, loaded on every page).
const NAME_SERIF = "'Playfair Display', Georgia, serif";

// A gold hairline inset from the card edge, like a fine restaurant menu.
const FRAME_INSET = 36;
const FRAME_ALPHA = 0.55;

// The logo badge: a rounded rectangle that hugs the logo's aspect ratio
// (content box 640x200 max), so it never becomes a box-in-box.
const LOGO_BOX_W = 640;
const LOGO_BOX_H = 200;
const LOGO_PADDING = 18;
const LOGO_RADIUS = 16;
const LOGO_BADGE_TOP = 150;
const QR_PANEL = 860;
const QR_PANEL_TOP = 470;
const QR_PANEL_RADIUS = 18;
// 740px QR (incl. a 1-module margin) inside the 860px panel leaves ~4 modules
// of quiet zone, which phone-to-phone scanning needs.
const QR_SIZE = 740;
const NAME_SIZE = 92;
const NAME_Y = 1505;
// The label rides just clear of the name's ascenders, mirroring the print card.
const LABEL_Y = NAME_Y - 85;
const LABEL_ALPHA = 0.7;
const STAR_OUTER = 34;
const STAR_INNER = 15;
const STAR_GAP = 88;
const STARS_Y = 1610;

export async function renderWaiterCard(opts: WaiterCardOptions): Promise<Blob> {
  const { default: QRCode } = await import('qrcode');

  const [qrPng, logo] = await Promise.all([
    QRCode.toDataURL(opts.url, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: QR_SIZE,
      color: { dark: '#111111', light: '#FFFFFF' },
    }),
    loadImage(opts.logoSrc).catch(() => null),
  ]);
  const qrImg = await loadImage(qrPng);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Playfair is a webfont: resolve it before the first fillText so the name
  // never lands in the fallback face. `document.fonts` is missing in some
  // environments and the load can fail — both are fine, Georgia takes over.
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.load(`700 ${NAME_SIZE}px 'Playfair Display'`);
    } catch {
      // Ignore: the name still renders in the fallback serif.
    }
  }

  // Background: a radial wash (centre -> edges) + the gold rule across the top.
  const bg = ctx.createRadialGradient(
    CARD_W / 2,
    CARD_H * 0.4,
    0,
    CARD_W / 2,
    CARD_H * 0.4,
    CARD_H * 0.75,
  );
  bg.addColorStop(0, BG_CENTER);
  bg.addColorStop(1, BG_EDGE);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, CARD_W, 8);

  // ── Gold hairline frame, inset from every edge ─────────────
  // Everything below stays well inside it (nothing touches or crosses).
  ctx.globalAlpha = FRAME_ALPHA;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.strokeRect(FRAME_INSET, FRAME_INSET, CARD_W - FRAME_INSET * 2, CARD_H - FRAME_INSET * 2);
  ctx.globalAlpha = 1;

  // ── Logo badge (rounded rect that hugs the logo, no box-in-box) ──
  if (logo) {
    const scale = Math.min(LOGO_BOX_W / logo.width, LOGO_BOX_H / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const badgeW = w + LOGO_PADDING * 2;
    const badgeH = h + LOGO_PADDING * 2;
    const badgeLeft = (CARD_W - badgeW) / 2;
    ctx.fillStyle = opts.logoDarkBg ? '#111111' : '#FFFFFF';
    fillRoundedRect(ctx, badgeLeft, LOGO_BADGE_TOP, badgeW, badgeH, LOGO_RADIUS);

    // contain, never stretch
    ctx.drawImage(logo, badgeLeft + LOGO_PADDING, LOGO_BADGE_TOP + LOGO_PADDING, w, h);
  } else {
    ctx.fillStyle = '#FFFFFF';
    drawFitted(ctx, opts.restaurantName, {
      font: `bold 64px ${SERIF}`,
      size: 64,
      maxWidth: 900,
      x: CARD_W / 2,
      y: LOGO_BADGE_TOP + LOGO_BOX_H / 2 + 22,
    });
  }

  // ── QR panel (dark-on-light: scanners need the contrast) ───
  ctx.fillStyle = '#FFFFFF';
  fillRoundedRect(ctx, (CARD_W - QR_PANEL) / 2, QR_PANEL_TOP, QR_PANEL, QR_PANEL, QR_PANEL_RADIUS);
  ctx.drawImage(qrImg, (CARD_W - QR_SIZE) / 2, QR_PANEL_TOP + (QR_PANEL - QR_SIZE) / 2, QR_SIZE, QR_SIZE);

  // ── Small gold label above the name ────────────────────────
  ctx.globalAlpha = LABEL_ALPHA;
  setLetterSpacing(ctx, '6px');
  ctx.fillStyle = GOLD;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText('LE ATENDIÓ', CARD_W / 2, LABEL_Y);
  ctx.globalAlpha = 1;
  setLetterSpacing(ctx, '0px');

  // ── Waiter name ────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  drawFitted(ctx, opts.waiterName, {
    font: `bold ${NAME_SIZE}px ${NAME_SERIF}`,
    size: NAME_SIZE,
    maxWidth: 960,
    x: CARD_W / 2,
    y: NAME_Y,
  });

  // ── Five gold stars, directly above the call to action ─────
  ctx.fillStyle = GOLD;
  for (let i = 0; i < 5; i += 1) {
    drawStar(ctx, CARD_W / 2 + (i - 2) * STAR_GAP, STARS_Y, STAR_OUTER, STAR_INNER);
  }

  // ── Call to action ─────────────────────────────────────────
  ctx.fillStyle = GOLD;
  ctx.font = `600 50px ${SANS}`;
  ctx.fillText('Escanee para calificar', CARD_W / 2, 1705);

  // ── Footer ─────────────────────────────────────────────────
  setLetterSpacing(ctx, '8px');
  ctx.fillStyle = '#5A5A5A';
  ctx.font = `bold 24px ${SANS}`;
  ctx.fillText('RATETAP', CARD_W / 2, 1830);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/** Draw `text` on one baseline, shrinking the font only if it would overflow. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: { font: string; size: number; maxWidth: number; x: number; y: number },
) {
  const [weight, family] = splitFont(opts.font);
  let size = opts.size;
  const apply = () => {
    ctx.font = `${weight} ${size}px ${family}`;
  };
  apply();
  while (size > 28 && ctx.measureText(text).width > opts.maxWidth) {
    size -= 2;
    apply();
  }
  ctx.fillText(text, opts.x, opts.y);
}

/** 'bold 84px Georgia, serif' -> ['bold', 'Georgia, serif'] */
function splitFont(font: string): [string, string] {
  const match = font.match(/^(.*?)(?:\s+)?(\d+px\s+)(.+)$/);
  if (!match) return ['normal', font];
  return [match[1].trim(), match[3]];
}

/** Canvas letterSpacing is Chromium/Safari 16+ — a no-op where unsupported. */
function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = value;
}

/** A filled 5-point star: 10-point path, the first point straight up. */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const rounded = ctx as CanvasRenderingContext2D & {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  };
  if (typeof rounded.roundRect === 'function') {
    ctx.beginPath();
    rounded.roundRect(x, y, w, h, radius);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, w, h);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed to load: ${src}`));
    img.src = src;
  });
}
