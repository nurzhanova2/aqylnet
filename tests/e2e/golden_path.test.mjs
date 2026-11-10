// End-to-end golden path: create a simulation, run one round, generate the
// report — driving the real UI against the real backend.
//
// Needs a frontend and a backend already running. Either frontend works:
//
//   APP_URL=http://127.0.0.1:8080  — the nginx thin frontend (serves aqylnet/dist,
//                                    proxies /api; run `npm run build` first)
//   APP_URL=http://127.0.0.1:5174  — the Vite dev server (`npm run dev`)
//
// Use 127.0.0.1, not localhost: on this machine localhost resolves to ::1 and
// the answer that comes back over IPv6 is not ours (see .ai/CONTEXT.md).
//
// Run the e2e files SEQUENTIALLY (`npm run test:e2e`, which passes
// --test-concurrency=1). They share one backend and one persona library: run
// in parallel, this file picks the first two library personas and makes them
// speak while the other file is creating and deleting a persona of its own,
// and whichever cleanup loses the race leaves a persona that "has already
// spoken" and can no longer be deleted.
//
// Every selector here was rewritten on 28.10 against the current screens. The
// previous set was written before the redesign and had drifted far enough to
// be useless: it clicked a button labelled '＋ Новая симуляция' (the ＋ is
// gone), waited for headings «НАСТРОЙКА СИМУЛЯЦИИ», «Состав фокус-группы» and
// «АНАЛИТИЧЕСКИЙ ОТЧЁТ» that no longer exist, pressed a play button named
// /Продолжить|Генерация/ when a fresh project's button says «Запустить», and
// matched persona cards by `[class*="personaCard"]` — a class that was never
// there, the real one is `personCard`. Five of its seven tests failed against
// working code, which is the expensive kind of failing test: it teaches
// everyone to read red as normal.
//
// Where a choice existed, this version prefers roles and accessible names over
// decorative text, because kickers and section captions are what the redesign
// changed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { api } from '../api/helpers.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8080';

const DOCUMENT_TEXT = [
  'Национальный Банк вводит новые требования к капиталу банков второго уровня.',
  'Банк обязан рассчитывать коэффициент долговой нагрузки заёмщика по данным кредитного бюро.',
  'Выдача кредита заёмщику с нагрузкой выше 50 процентов официального дохода запрещается.',
  'Настоящие Правила не применяются к договорам, заключённым до введения их в действие.',
].join('\n');

let browser, page;
let createdProjectId;
const consoleErrors = [];
const failedRequests = [];

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
});


/**
 * Deletes a project that was created through the UI.
 *
 * Such a project carries the browser's own X-Session-Key, and the ownership
 * guard answers 404 to a DELETE without it (middlewares/projectOwnership.ts), so the plain
 * deleteProjectSafe silently leaves it behind — that is how ten stray "Новая
 * симуляция" rows accumulated.
 */
async function deleteUiProject(id) {
  if (!id) return;
  const key = await page.evaluate(() => localStorage.getItem('aqylnet.sessionKey')).catch(() => null);
  const res = await api('DELETE', `/projects/${id}`, undefined, key ? { headers: { 'X-Session-Key': key } } : {});
  if (res.status !== 200) console.error(`[cleanup] проект ${id} не удалён: ${res.status} ${JSON.stringify(res.json)}`);
}

after(async () => {
  await deleteUiProject(createdProjectId);
  await browser?.close();
});

describe('Golden path: create simulation -> run one round -> generate report', () => {
  test('app shell loads with no console errors', async () => {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'AqylNet' }).waitFor({ timeout: 15000 });
    assert.equal(consoleErrors.length, 0, `unexpected console errors on load: ${consoleErrors.join(' | ')}`);
  });

  test('Projects -> New simulation opens the Setup screen', async () => {
    // A fresh browser lands on whichever project the app restores, which may
    // be a legacy one (ownerKey = null rows are visible to every workspace),
    // so this starts by navigating rather than assuming the current screen.
    await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
    await page.getByText('Мои симуляции').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Новая симуляция/ }).first().click();
    await page.getByText('Настройка фокус-группы').waitFor({ timeout: 10000 });
  });

  let chosenNames = [];

  test('paste the document, trim the cast to 2, launch', async () => {
    // The document block opens on the «Файл» tab; the textarea only exists
    // after switching to «Текст». The segment control is a tablist, so these
    // are tabs — as `button` they are invisible to getByRole, which is how the
    // first rewrite of this test still timed out.
    await page.getByRole('tab', { name: 'Текст', exact: true }).click();
    const docArea = page.getByPlaceholder(/Вставьте фрагмент документа/);
    await docArea.waitFor({ timeout: 5000 });
    await docArea.fill(DOCUMENT_TEXT);

    // Setup pre-selects up to the first 8 library personas, so the cast is
    // trimmed rather than picked. Each card carries a remove button with an
    // accessible name — a far steadier handle than a CSS module class. The
    // name has to be anchored on «из группы»: the key-messages field has its
    // own «Убрать сообщение N» buttons, and a looser /^Убрать / matched nine
    // buttons for eight personas.
    const removeButtons = page.getByRole('button', { name: /^Убрать .+ из группы$/ });
    let count = await removeButtons.count();
    assert.ok(count >= 2, `expected at least 2 personas pre-selected, found ${count}`);
    while (count > 2) {
      await removeButtons.last().click();
      await page.waitForTimeout(80);
      count = await removeButtons.count();
    }

    chosenNames = await page.locator('[class*="personName"]').allInnerTexts();
    chosenNames = chosenNames.map((n) => n.trim()).filter(Boolean);
    assert.equal(chosenNames.length, 2, `expected 2 names on the cards, got ${JSON.stringify(chosenNames)}`);

    const counter = page.locator('[class*="counter"]', { hasText: /\d+ \/ 8/ }).first();
    assert.match((await counter.innerText()).trim(), /^2 \/ 8$/, 'the «Участники» counter must agree with the cards');

    // The response is captured so the project can be deleted afterwards.
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/projects')),
      page.getByRole('button', { name: 'Запустить симуляцию' }).click(),
    ]);
    createdProjectId = (await created.json()).data?.id;
    assert.ok(createdProjectId, 'POST /projects must return the new project id');

    // A successful launch lands on the discussion screen, whose top bar shows
    // the round pill. Creating the project calls the model for per-document
    // stances, so this is not instant.
    await page.getByText(/Раунд 0 \/ \d+/).waitFor({ timeout: 60000 });
  });

  test('the discussion screen shows exactly the cast that was chosen', async () => {
    for (const name of chosenNames) {
      await page.getByText(name, { exact: false }).first().waitFor({ timeout: 10000 });
    }
  });

  test('running one round advances the counter and writes replies', async () => {
    // 'Запустить' at round 0, 'Продолжить' afterwards, 'Генерация…' while the
    // call is in flight — see playLabel() in TopBar.jsx.
    await page.getByRole('button', { name: /Запустить|Продолжить/ }).first().click();

    // Two personas plus a moderator question, then the UI reveals the replies
    // one by one.
    await page.getByText(/Раунд 1 \/ \d+/).waitFor({ timeout: 180000 });

    const transcript = await page.getByRole('tab', { name: 'Ход дискуссии' }).count();
    assert.ok(transcript > 0, 'the transcript tab must exist after a round');
  });

  test('generating the report opens a report with content', async () => {
    await page.getByRole('button', { name: 'Сформировать отчёт' }).click();

    // Two parallel LLM calls (report + document audit) over the transcript.
    const openReport = page.getByRole('button', { name: 'Открыть отчёт' });
    await openReport.waitFor({ timeout: 300000 });
    await openReport.click();

    await page.getByText('Итоги фокус-группы').waitFor({ timeout: 15000 });
    await page.getByText('Рекомендации', { exact: true }).first().waitFor({ timeout: 15000 });

    const pdfBtn = page.getByRole('button', { name: /Скачать PDF/ });
    await pdfBtn.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await pdfBtn.isDisabled(), false, 'PDF export must be enabled once a report exists');
  });

  test('no failed network requests occurred during the whole golden path', () => {
    assert.deepEqual(failedRequests, [], `unexpected failed requests: ${failedRequests.join(' | ')}`);
  });
});
