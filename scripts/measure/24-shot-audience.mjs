// One-off visual check of the «Кому понятен текст» block (A1 stage 2). Not a
// test: opens a project with its session key and saves screenshots.
//   cd tests && node ../scripts/measure/19-shot-persona-scores.mjs <sessionKey> <outDir>  (playwright from tests/node_modules)
import { chromium } from 'playwright';

const [key, outDir, projectId = '2554'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.addInitScript(([k, id]) => {
  localStorage.setItem('aqylnet.sessionKey', k);
  localStorage.setItem('aqylnet:lastProjectId', id);
}, [key, projectId]);
await page.goto('http://127.0.0.1:8080/');
await page.getByText('Отчёт', { exact: false }).first().click().catch(() => {});
await page.waitForSelector('text=Кому понятен текст', { timeout: 20000 });
const block = page.locator('section:has(> div h2:text-is("Кому понятен текст"))').first();
// The app scrolls inside its own container, so a tall viewport is what
// lets the whole block render on screen at once.
await page.setViewportSize({ width: 1360, height: 3200 });
await block.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await block.screenshot({ path: `${outDir}/audience-block.png` });
await page.setViewportSize({ width: 400, height: 6000 });
await block.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await block.screenshot({ path: `${outDir}/audience-block-narrow.png` });
await browser.close();
console.log('ok');
