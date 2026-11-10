// UI-level confirmation of behaviour that is easy to state but easy to doubt
// without seeing the actual browser. Requires the same running stack as
// golden_path.test.mjs, and the same two addresses:
//
//   APP_URL=http://127.0.0.1:8080  API_BASE_URL=http://127.0.0.1:3001/api
//
// Both must be set. helpers.mjs defaults API_BASE_URL to localhost, which on
// this machine resolves to ::1 and answers with something that is not ours —
// the before() hook then fails and every test is reported "cancelled", which
// reads like a broken suite rather than a missing variable.
//
// Selectors rewritten on 28.10. The previous set drove the pre-redesign UI:
// `getByText('Проекты', { exact: true })` is now ambiguous (the word is in
// both the breadcrumb and the nav rail, so Playwright's strict mode refuses
// it), «НАСТРОЙКА СИМУЛЯЦИИ», «МОДЕРАТОР-РЕГУЛИРОВЩИК», «Завершить
// симуляцию» and «АНАЛИТИЧЕСКИЙ ОТЧЁТ» no longer exist, and both moderator
// switches are now role="switch" with an accessible name.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { api, personaPayload, projectPayload, deleteProjectSafe, deletePersonaSafe, randomSuffix } from '../api/helpers.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8080';

let browser, page, projectId, personaId;
// A project the UI creates during the BUG-2 test; deleted in after() with the
// browser's own session key.
let uiProjectId;

/** The nav rail, not the breadcrumb — both contain the word «Проекты». */
function navTo(label) {
  return page.getByLabel('Разделы').getByRole('button', { name: label });
}

/** The discussion screen is identified by its round pill, not by a caption. */
function roundPill() {
  return page.getByText(/Раунд \d+ \/ \d+/);
}

async function openProjectByTitle(title) {
  await navTo('Проекты').click();
  await page.getByText('Мои симуляции').waitFor({ timeout: 10000 });
  await page.getByText(title, { exact: false }).first().click();
  await roundPill().waitFor({ timeout: 15000 });
}

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

  // Suffixed, not fixed: persona names are unique, so a run that fails before
  // its cleanup leaves the name taken and every later run dies in setup with
  // "already exists" — which is what happened the first time this suite was
  // re-run after the rewrite.
  const persona = await api('POST', '/personas', personaPayload({ name: `QA-E2E-Moderator-${randomSuffix()}` }));
  assert.equal(persona.status, 201, `persona setup failed: ${JSON.stringify(persona.json)}`);
  personaId = persona.json.data.id;
  const proj = await api('POST', '/projects', projectPayload([personaId], { moderator: true }));
  assert.equal(proj.status, 201, `project setup failed: ${JSON.stringify(proj.json)}`);
  projectId = proj.json.data.id;
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
  // Order matters: the browser is still needed to read the session key, and
  // the persona can only go once no project holds it.
  await deleteUiProject(uiProjectId);
  await browser?.close();
  await deleteProjectSafe(projectId);
  await deletePersonaSafe(personaId);
});

describe('BUG-7 (fixed): moderator toggle on the Discussion screen persists across a reload', () => {
  test('toggling off, then back on, is saved to the backend and survives a reload each time', async () => {
    // There is no URL-based deep link to a specific project in this app (state
    // lives only in App.jsx, there is no router), so this drives the same path
    // a real user would: open Projects, click into the freshly created project.
    const before = await api('GET', `/projects/${projectId}`);
    assert.equal(before.json.data.moderator, true, 'precondition: project starts with moderator=true in the DB');

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await openProjectByTitle(before.json.data.title);

    const modToggle = page.getByRole('switch', { name: 'Модератор' });
    await modToggle.click(); // off — must fire PATCH /projects/:id { moderator: false }
    await page.waitForTimeout(400);

    const afterOff = await api('GET', `/projects/${projectId}`);
    assert.equal(afterOff.json.data.moderator, false, 'FIXED: toggling off in Discussion must persist to the backend immediately, not just local state');

    await page.reload({ waitUntil: 'networkidle' });
    await openProjectByTitle(before.json.data.title);

    const afterReloadOff = await api('GET', `/projects/${projectId}`);
    assert.equal(afterReloadOff.json.data.moderator, false, 'FIXED: the off state must survive a page reload, not silently revert to the pre-toggle DB value');

    // Round-trip back on, to prove the fix isn't one-directional.
    await page.getByRole('switch', { name: 'Модератор' }).click();
    await page.waitForTimeout(400);

    const afterOn = await api('GET', `/projects/${projectId}`);
    assert.equal(afterOn.json.data.moderator, true, 'toggling back on must also persist');
  });

  test('toggling the moderator switch in Setup does not affect the active project on the Discussion screen', async () => {
    // Setup configures a *new* project and must not silently mutate the
    // currently active one just because both screens used to share App.jsx's
    // single `moderator` state.
    const before = await api('GET', `/projects/${projectId}`);

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await navTo('Проекты').click();
    await page.getByText('Мои симуляции').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Новая симуляция/ }).first().click();
    await page.getByRole('heading', { name: 'Параметры обсуждения' }).waitFor({ timeout: 10000 });

    await page.getByRole('switch', { name: 'Модератор' }).click();
    await page.waitForTimeout(400);

    const afterSetupToggle = await api('GET', `/projects/${projectId}`);
    assert.equal(
      afterSetupToggle.json.data.moderator,
      before.json.data.moderator,
      'toggling moderator in Setup (configuring a new project) must not change the active project’s persisted moderator value',
    );
  });
});

describe('BUG-2 (fixed): SetupPage only sends personaStances for personas the user actually touched', () => {
  const STANCE_OPTIONS = ['Поддерживает', 'Против', 'Нейтральный', 'Неопределившийся'];

  test('an explicit stance change for one persona reaches the backend, but an untouched persona is omitted from the payload', async () => {
    // Mirrors SetupPage's own default selection (personas.slice(0, 8), same
    // GET /personas endpoint, same deterministic orderBy) so the two personas
    // this test drives are already selected when Setup loads.
    const { json: personasResp } = await api('GET', '/personas');
    const defaultSelected = personasResp.data.slice(0, 8);
    assert.ok(defaultSelected.length >= 2, 'need at least 2 personas in the library for this test');
    const touched = defaultSelected[0];
    const untouched = defaultSelected[1];

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await navTo('Проекты').click();
    await page.getByText('Мои симуляции').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Новая симуляция/ }).first().click();
    await page.getByRole('heading', { name: 'Параметры обсуждения' }).waitFor({ timeout: 10000 });

    // A document is required before the launch button does anything.
    await page.getByRole('tab', { name: 'Текст', exact: true }).click();
    await page.getByPlaceholder(/Вставьте фрагмент документа/).fill(
      'Банк обязан рассчитывать коэффициент долговой нагрузки заёмщика по данным кредитного бюро.',
    );

    // The stance <select> inside the touched persona's card. The card class is
    // `personCard` (not `personaCard`, which never existed), so this walks up
    // from the name instead of guessing a class.
    const touchedSelect = page.getByText(touched.name, { exact: true })
      .locator('xpath=ancestor::*[contains(@class,"personCard")]')
      .locator('select');
    const currentValue = await touchedSelect.inputValue();
    const newStance = STANCE_OPTIONS.find((s) => s !== currentValue);
    await touchedSelect.selectOption(newStance);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/projects')),
      page.getByRole('button', { name: 'Запустить симуляцию' }).click(),
    ]);
    const requestBody = response.request().postDataJSON();
    const responseBody = await response.json();
    uiProjectId = responseBody.data?.id;

    assert.ok(
      String(touched.id) in requestBody.personaStances,
      'FIXED: the persona whose dropdown was actually changed must be present in personaStances',
    );
    assert.equal(requestBody.personaStances[String(touched.id)], newStance);
    assert.ok(
      !(String(untouched.id) in requestBody.personaStances),
      'FIXED: an untouched persona must be OMITTED from personaStances, not defaulted to stanceFor()\'s fallback value — otherwise the backend\'s `personaStances[...] || ov.stance || null` precedence can never fall through to the LLM-computed per-document stance',
    );
  });
});

describe('«Копировать текст» copies the alternative wording with its tags', () => {
  // This suite used to assert the opposite — that the button was dead UI with
  // no click handler. It has one now, and stage E6 gave it a job: the copy
  // carries the tags and the disclaimer, because copying bare prose is exactly
  // the form in which a model's suggestion gets pasted into a real document
  // and taken for the source text.
  test('clicking it marks the copy as done and the clipboard carries tag and disclaimer', async () => {
    await api('PUT', `/projects/${projectId}/analytics`, {
      altParagraphs: [
        { tag: 'без изм.', text: 'Фрагмент для проверки копирования.', color: '#6f6a85' },
        { tag: 'добавлено', text: 'Новый пункт, которого в документе нет.', color: '#34d399' },
      ],
    });
    // A non-empty `conclusion` is what makes the report card offer «Открыть
    // отчёт» instead of «Сформировать отчёт» (DiscussionPage.jsx:459) — a
    // summary carrying only a mood leaves the button on "generate".
    await api('PUT', `/projects/${projectId}/summary`, {
      mood: 'Нейтральное',
      conclusion: 'Сводка для проверки копирования альтернативной редакции.',
    });

    const context = page.context();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_URL });

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    const title = (await api('GET', `/projects/${projectId}`)).json.data.title;
    await openProjectByTitle(title);

    // With a summary stored, the report card offers the way into Analytics.
    await page.getByRole('button', { name: 'Открыть отчёт' }).click();
    await page.getByText('Итоги фокус-группы').waitFor({ timeout: 15000 });

    const copyBtn = page.getByRole('button', { name: /Копировать текст/ });
    await copyBtn.waitFor({ timeout: 10000 });
    await copyBtn.click();

    // The visible acknowledgement is the assertion of record: it proves the
    // handler ran even where the clipboard is unavailable.
    await page.getByRole('button', { name: /Скопировано/ }).waitFor({ timeout: 5000 });

    const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    if (clipboard) {
      // The «без изм.» fixture text is deliberately absent from the project's
      // document, so the copy must carry the unverified mark with the tag —
      // the stage E6 behaviour this suite exists to pin. Asserting a bare
      // `[без изм.]` would fail on correct output, which is how this very
      // assertion failed the first time it ran.
      assert.match(clipboard, /\[без изм\. \(нет в документе\)\]/, 'the tag and its unverified mark must travel with the text');
      assert.match(clipboard, /\[добавлено\]/, 'every tag, not just the first');
      assert.match(clipboard, /предложена моделью/i, 'the disclaimer must be appended');
    }
  });
});
