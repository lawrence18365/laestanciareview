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
const BG = '#141414';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

const LOGO_TILE = 300;
const LOGO_TILE_TOP = 170;
const QR_PANEL = 820;
const QR_PANEL_TOP = 640;
const QR_PANEL_RADIUS = 18;
// 700px QR (incl. a 1-module margin) inside the 820px panel leaves ~4 modules
// of quiet zone, which phone-to-phone scanning needs.
const QR_SIZE = 700;

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

  // Background + the gold rule that runs across the very top.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, CARD_W, 8);

  // ── Logo tile ──────────────────────────────────────────────
  const tileLeft = (CARD_W - LOGO_TILE) / 2;
  if (logo) {
    ctx.fillStyle = opts.logoDarkBg ? '#111111' : '#FFFFFF';
    ctx.fillRect(tileLeft, LOGO_TILE_TOP, LOGO_TILE, LOGO_TILE);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.strokeRect(tileLeft + 1.5, LOGO_TILE_TOP + 1.5, LOGO_TILE - 3, LOGO_TILE - 3);

    // contain, never stretch
    const box = LOGO_TILE - 28 * 2;
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, tileLeft + (LOGO_TILE - w) / 2, LOGO_TILE_TOP + (LOGO_TILE - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#FFFFFF';
    drawFitted(ctx, opts.restaurantName, {
      font: `bold 64px ${SERIF}`,
      size: 64,
      maxWidth: 900,
      x: CARD_W / 2,
      y: LOGO_TILE_TOP + LOGO_TILE / 2 + 22,
    });
  }

  // ── Restaurant name (already drawn large when the logo is missing) ──
  if (logo) {
    setLetterSpacing(ctx, '6px');
    ctx.fillStyle = '#A3A3A3';
    ctx.font = `30px ${SANS}`;
    ctx.fillText(opts.restaurantName.toUpperCase(), CARD_W / 2, 540);
  }

  // ── QR panel (dark-on-light: scanners need the contrast) ───
  setLetterSpacing(ctx, '0px');
  ctx.fillStyle = '#FFFFFF';
  fillRoundedRect(ctx, (CARD_W - QR_PANEL) / 2, QR_PANEL_TOP, QR_PANEL, QR_PANEL, QR_PANEL_RADIUS);
  ctx.drawImage(qrImg, (CARD_W - QR_SIZE) / 2, QR_PANEL_TOP + (QR_PANEL - QR_SIZE) / 2, QR_SIZE, QR_SIZE);

  // ── Waiter name ────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  drawFitted(ctx, opts.waiterName, {
    font: `bold 84px ${SERIF}`,
    size: 84,
    maxWidth: 960,
    x: CARD_W / 2,
    y: 1600,
  });

  // ── Call to action ─────────────────────────────────────────
  ctx.fillStyle = GOLD;
  ctx.font = `40px ${SANS}`;
  ctx.fillText('Escanee para calificar', CARD_W / 2, 1690);

  // ── Footer ─────────────────────────────────────────────────
  setLetterSpacing(ctx, '8px');
  ctx.fillStyle = '#5A5A5A';
  ctx.font = `bold 24px ${SANS}`;
  ctx.fillText('RATETAP', CARD_W / 2, 1850);

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
