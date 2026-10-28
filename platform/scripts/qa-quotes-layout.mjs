import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { webkit } from 'playwright';

/**
 * Text ranges are clipped to scroll ancestors before testing. Both texts must
 * have a visible sample, so content behind an opaque sticky surface is excluded.
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
export async function findVisibleTextClashes(page, selector = '.operator-chrome, nav, .ql-root') {
  return page.evaluate((scope) => {
    const ranges = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const visibleAt = (element, rect) => {
      const xs = [rect.left + 1, (rect.left + rect.right) / 2, rect.right - 1];
      const ys = [rect.top + 1, (rect.top + rect.bottom) / 2, rect.bottom - 1];
      return xs.some((x) => ys.some((y) => {
        const top = document.elementFromPoint(x, y);
        return top && (top === element || element.contains(top));
      }));
    };
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!node.textContent?.trim() || !element?.closest(scope) || element.closest('style,script,svg')) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
        let hidden = false;
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor);
          if (css.opacity === '0' || css.visibility !== 'visible') hidden = true;
          const box = ancestor.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
            left = Math.max(left, box.left + ancestor.clientLeft);
            right = Math.min(right, box.left + ancestor.clientLeft + ancestor.clientWidth);
          }
          if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
            top = Math.max(top, box.top + ancestor.clientTop);
            bottom = Math.min(bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
          }
        }
        const clipped = { left, right, top, bottom };
        if (!hidden && right - left > 2 && bottom - top > 2 && visibleAt(element, clipped)) {
          ranges.push({ element, text: node.textContent.trim(), ...clipped });
        }
      }
    }
    const clashes = [];
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i], b = ranges[j];
        if (a.element === b.element) continue;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 1 && height > 1) clashes.push({ a: a.text, b: b.text, width, height });
      }
    }
    return clashes;
  }, selector);
}

/** @param {import('playwright').Page} page */
export async function quoteLayoutMetrics(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    selects: [...document.querySelectorAll('.operator-chrome select, .ql-campaign-select')].map((el) => ({
      height: el.getBoundingClientRect().height,
      appearance: getComputedStyle(el).appearance,
    })),
    headerPosition: document.querySelector('.cb-header') && getComputedStyle(document.querySelector('.cb-header')).position,
  }));
}

// The owning lead may run this against their existing synthetic fixture. This
// command never starts a server, saves a quote or invokes an external action.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = process.argv.indexOf('--fixture');
  const url = process.argv.indexOf('--url');
  if (fixture < 0 && url < 0) throw new Error('Pass --fixture /absolute/fixture.html or --url <lead-owned synthetic quote URL>');
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const reports = [];
    if (fixture >= 0) await page.route('**/*', (route) => route.abort());
    for (const [width, height] of [[1180, 820], [1080, 810], [810, 1080], [820, 1080]]) {
      await page.setViewportSize({ width, height });
      if (fixture >= 0) await page.setContent(await readFile(process.argv[fixture + 1], 'utf8'));
      else await page.goto(process.argv[url + 1], { waitUntil: 'networkidle' });
      await page.locator('.cotizador-root, .ql-root').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const tab of ['Plantillas', 'Constructor', 'Carta', 'Vista cliente']) {
        const button = page.locator('.cb-tabs .tab').filter({ hasText: new RegExp(`^${tab}$`) });
        if (await button.count()) await button.click();
        for (const scroll of [0, 500]) {
          await page.evaluate((y) => window.scrollTo(0, y), scroll);
          reports.push({ tab, scroll, ...await quoteLayoutMetrics(page), clashes: await findVisibleTextClashes(page) });
        }
      }
    }
    console.log(JSON.stringify(reports, null, 2));
    if (reports.some((r) => r.horizontalOverflow > 1 || r.selects.some((s) => s.height < 44) || r.clashes.length)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
