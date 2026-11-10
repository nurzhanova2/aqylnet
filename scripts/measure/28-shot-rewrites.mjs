// A1 stage 3: screenshots of «Три версии текста» and the six exported files
// through the UI. Run from tests/ (playwright lives there):
//   cp ../scripts/measure/28-shot-rewrites.mjs _rw.mjs && node _rw.mjs <key> <projectId> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [key, projectId, outDir] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(([k, id]) => {
  localStorage.setItem('aqylnet.sessionKey', k);
  localStorage.setItem('aqylnet:lastProjectId', id);
}, [key, projectId]);
await page.goto('http://127.0.0.1:8080/');
await page.getByText('Отчёт', { exact: false }).first().click().catch(() => {});
await page.waitForSelector('text=Три версии текста', { timeout: 30000 });
const block = page.locator('section:has(> div h2:text-is("Три версии текста"))').first();
await page.setViewportSize({ width: 1360, height: 5000 });

for (const [tab, file] of [['Карточка', 'card'], ['Справка', 'brief'], ['Полный текст', 'full']]) {
  await block.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  await page.waitForTimeout(300);
  await block.scrollIntoViewIfNeeded();
  await block.screenshot({ path: path.join(outDir, `rewrites-${file}.png`) });
  for (const [label, ext] of [['PDF', 'pdf'], ['Word', 'docx']]) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      block.getByRole('button', { name: label, exact: true }).click(),
    ]);
    const target = path.join(outDir, `${file}.${ext}`);
    await download.saveAs(target);
    console.log(`${file}.${ext}: ${fs.statSync(target).size} bytes (${download.suggestedFilename()})`);
  }
}
await page.setViewportSize({ width: 400, height: 6000 });
await block.getByRole('tab', { name: /^Карточка/ }).click();
await block.screenshot({ path: path.join(outDir, 'rewrites-card-narrow.png') });
await browser.close();
