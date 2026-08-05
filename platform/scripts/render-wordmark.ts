#!/usr/bin/env npx tsx
/**
 * Render the RateTap wordmark as a transparent PNG using the app's brand
 * typeface (Outfit) and primary accent color (#2563EB, the "Tap" blue from
 * the logo). Output is written to public/ratetap-wordmark.png at 2x scale.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const OUTPUT_PATH = resolve(__dirname, '../public/ratetap-wordmark.png');

// Brand values from globals.css / layout.tsx Google Fonts / logo.
const BRAND_FONT = 'Outfit, sans-serif';
const BRAND_COLOR = '#2563EB'; // RateTap blue from the logo
const CANVAS_WIDTH = 900; // 2x of 450px target
const CANVAS_HEIGHT = 240; // 2x of 120px target
const FONT_SIZE = 132; // 2x of 66px target

const HTML = `<!DOCTYPE html>
<html>
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${CANVAS_WIDTH}px;
      height: ${CANVAS_HEIGHT}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
    }
    .wordmark {
      font-family: '${BRAND_FONT.split(',')[0].trim()}', sans-serif;
      font-size: ${FONT_SIZE}px;
      font-weight: 700;
      color: ${BRAND_COLOR};
      letter-spacing: -0.03em;
      line-height: 1;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="wordmark">RateTap</div>
</body>
</html>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  });

  await page.setContent(HTML, { waitUntil: 'networkidle' });

  // Wait for the web font to finish loading and rendering.
  await page.waitForTimeout(500);

  const element = await page.$('.wordmark');
  if (!element) throw new Error('wordmark element not found');

  const screenshot = await element.screenshot({
    type: 'png',
    omitBackground: true,
  });

  writeFileSync(OUTPUT_PATH, screenshot);
  await browser.close();

  console.log(`✓ Wordmark rendered: ${OUTPUT_PATH}`);
  console.log(`  Font: ${BRAND_FONT}, Color: ${BRAND_COLOR}`);
}

main().catch((error) => {
  console.error('✗ Wordmark render failed:', error);
  process.exit(1);
});
