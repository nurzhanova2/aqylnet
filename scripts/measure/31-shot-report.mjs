// The report page in slices, for comparison with the «Отчёт — Graphite Green»
// mockup. Run from tests/ (playwright lives there):
//   cp ../scripts/measure/31-shot-report.mjs _rp.mjs && node _rp.mjs <key> <projectId> <outDir> [width]
import { chromium } from 'playwright';
import path from 'node:path';

const [key, projectId, outDir, width = '1440'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 1000 } });
await page.addInitScript(([k, id]) => {
  localStorage.setItem('aqylnet.sessionKey', k);
  localStorage.setItem('aqylnet:lastProjectId', id);
}, [key, projectId]);
await page.goto('http://127.0.0.1:8080/');
await page.getByText('Отчёт', { exact: false }).first().click().catch(() => {});
await page.waitForSelector('text=Итоги фокус-группы', { timeout: 30000 });
await page.waitForTimeout(1500);
// The page scrolls inside its own container: grow the viewport to its height.
const h = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY === 'auto');
  return el ? el.scrollHeight + 120 : document.documentElement.scrollHeight;
});
await page.setViewportSize({ width: Number(width), height: Math.min(h, 16000) });
await page.waitForTimeout(800);
for (let y = 0, i = 0; y < h; y += 1300, i++) {
  await page.screenshot({ path: path.join(outDir, `rp-${width}-${i}.png`), clip: { x: 0, y, width: Number(width), height: Math.min(1300, h - y) } });
}
console.log('height', h);
await browser.close();
