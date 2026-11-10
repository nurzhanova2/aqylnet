import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// What actually goes over the wire (A1 stage 0, item 0.6).
//
// The thinking switch used to travel as `extra_body: {...}` — a Python-SDK
// idiom that openai-node sends as a literal key. It only worked because LiteLLM
// unpacks that key. This pins the flag as a top-level body key in every
// scenario, and pins the persona reading the whole document.
//
// fetch is replaced before llm.service is imported, because the OpenAI client
// captures it when it is constructed. Stub answers carry zero usage, so
// recordUsage writes nothing to the database.

interface Captured { body: Record<string, unknown> }
const captured: Captured[] = [];

function completion(content: string) {
  return {
    id: 'stub', object: 'chat.completion', created: 0, model: 'stub',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

let reply = 'ok';
type Llm = typeof import('./llm.service');
let llm: Llm;

before(async () => {
  process.env.LLM_API_KEY ||= 'test-key';
  process.env.LLM_DISABLE_THINKING = 'true';
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    captured.push({ body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(completion(reply)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  llm = await import('./llm.service');
});

const persona = {
  name: 'Алия', role: 'маркетолог', style: '', criticality: '', behaviorModel: '', reasoning: '', thinking: 'мысль',
  stance: 'Нейтральный', priority: '', fears: '', speechTone: '', argumentation: '', responseLength: 'Средний',
  typicalPhrases: '', interests: [], city: '', education: '', industry: '', employerType: '', income: '',
  openness: '', decisionMaking: '', personalSituation: '',
};

function last(): Record<string, unknown> {
  const c = captured[captured.length - 1];
  assert.ok(c, 'a request was sent');
  return c.body;
}

function assertThinkingFlag(body: Record<string, unknown>, scenario: string) {
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }, `${scenario}: flag at the top level`);
  assert.equal('extra_body' in body, false, `${scenario}: no literal extra_body key`);
  // A1 stage 0a: every system message carries today's date, so a document
  // dated this year is not read as the future.
  const system = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'system')?.content ?? '';
  assert.match(system, /Сегодня \d{1,2} \S+ \d{4} г\. Даты до сегодняшней — прошлое/, `${scenario}: today's date in the system message`);
}

describe('the thinking switch reaches the body as a top-level key', () => {
  test('suggest_personas', async () => {
    await llm.suggestPersonas('текст документа', [{ id: 1, name: 'А', role: 'р', stance: '', interests: [], industry: '' }], 1);
    assertThinkingFlag(last(), 'suggest_personas');
  });

  test('persona_positions', async () => {
    reply = '[]';
    await llm.generatePersonaDocumentPositions('текст документа', []);
    assertThinkingFlag(last(), 'persona_positions');
  });

  test('persona_response', async () => {
    reply = 'Реплика персоны.';
    await llm.generatePersonaResponse(persona, 'текст документа', []);
    assertThinkingFlag(last(), 'persona_response');
  });

  test('moderator_message', async () => {
    reply = 'Вопрос?';
    await llm.generateModeratorMessage([], 'текст документа', 'цель');
    assertThinkingFlag(last(), 'moderator_message');
  });

  test('discussion_report', async () => {
    reply = '{}';
    await llm.generateDiscussionReport('текст документа', [], [{ speaker: 'А', text: 'реплика' }], 'цель');
    assertThinkingFlag(last(), 'discussion_report');
  });

  test('document_audit — a section', async () => {
    reply = '{"issues":[],"note":"","scores":[{"key":"clarity","label":"Ясность","value":70,"note":""}]}';
    const r = await llm.generateSectionAudit({
      order: 0, total: 1, heading: '1. Раздел', text: 'текст раздела', outline: ['1. Раздел'],
      documentText: 'текст раздела', discussionTask: null, personas: [], timeline: [], goal: 'цель',
    });
    assert.equal(r.ok, true);
    assertThinkingFlag(last(), 'document_audit (section)');
  });

  test('document_audit — alignment', async () => {
    reply = '{"alignment":[]}';
    await llm.generateAudienceAlignment([], [{ speaker: 'А', text: 'реплика' }], ['сообщение']);
    assertThinkingFlag(last(), 'document_audit (alignment)');
  });

  test('audit_checklist', async () => {
    reply = '{"answers":[{"id":"decision-reason","section":"1.","quote":"Одно предложение."},{"id":"made-up","quote":"x"}]}';
    const answers = await llm.generateAuditChecklist('текст документа', ['1. Раздел']);
    assertThinkingFlag(last(), 'audit_checklist');
    assert.deepEqual(answers, [{ id: 'decision-reason', section: '1.', quote: 'Одно предложение.' }],
      'evidence only, no verdict from the model; an id the checklist does not know is dropped');
  });

  test('audit_contradictions — confirms candidates; none, no call', async () => {
    const claim = (id: number, section: string, direction: 'растёт' | 'снижается') =>
      ({ id, section, phenomenon: 'x', direction, type: 'факт' as const, quote: `q${id}` });
    const sent = captured.length;
    assert.deepEqual(await llm.confirmContradictions([]), []);
    assert.equal(captured.length, sent, 'no candidates — no request');

    reply = '{"confirmed":[{"k":1,"title":"противоречие"},{"k":99,"title":"нет такого"}]}';
    const pairs = await llm.confirmContradictions([{ k: 1, a: claim(1, 'A', 'растёт'), b: claim(2, 'B', 'снижается') }]);
    assertThinkingFlag(last(), 'audit_contradictions');
    assert.deepEqual(pairs.map((p) => [p.a, p.b]), [[1, 2]], 'a confirmation of an unknown candidate is dropped');
  });
});

describe('persona_score — research profile', () => {
  test('temperature 0.1, the thinking flag, today\'s date; the transcript is never sent; the scale is in the prompt', async () => {
    reply = '{"sections":[{"n":1,"read":"r","unclear":[],"unclearTerms":[],"quote":"q","quoteEffect":"помогло","scores":{"clarity":7,"reasons":6,"myAction":null,"rateSignal":null,"trust":6},"naReasons":{"myAction":"x","rateSignal":"y"}}],"mainTakeaway":"m","decision":"d","myAction":"a"}';
    const r = await llm.generatePersonaScore(persona, 'Текст документа.', [{ n: 1, title: '1. Раздел', terms: ['нейтральная ставка'] }]);
    const body = last();
    assertThinkingFlag(body, 'persona_score');
    assert.equal(body.temperature, 0.1);
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.match(user, /общие слова \(«при необходимости»\)/, 'the scale comes from config/scoringScale.ts');
    assert.match(user, /нейтральная ставка/, 'the section terms are listed');
    assert.equal(/СТЕНОГРАММА|ХОД_ОБСУЖДЕНИЯ/.test(user), false, 'independent of the discussion');
    assert.equal(r.ok, true);
  });
});

describe('section audit — audiences and claims', () => {
  test('an audience finding stays and carries its audience; with contradictions off no claims are asked or kept', async () => {
    reply = JSON.stringify({
      issues: [{ title: 'аудитория', category: 'audience', severity: 'High', quote: '', audience: 'depositors' }, { title: 'жаргон', category: 'terminology', severity: 'High', quote: '' }],
      claims: [
        { phenomenon: 'ожидания населения', direction: 'продолжают расти', type: 'факт', quote: 'a' },
        { phenomenon: 'ожидания населения', direction: 'растут', type: 'факт', quote: 'b' },
        { phenomenon: 'ставка', direction: '68,4%', type: 'факт', quote: 'c' },
        { phenomenon: 'инфляция', direction: 'замедлится', type: 'прогноз', quote: 'd' },
        { phenomenon: 'инфляция', direction: 'снижается', type: 'оценка', quote: 'e' },
      ],
      note: '', scores: [{ key: 'clarity', label: 'Ясность', value: 70, note: '' }],
    });
    const r = await llm.generateSectionAudit({
      order: 0, total: 1, heading: '1. Раздел', text: 'текст', outline: ['1. Раздел'],
      documentText: 'текст', discussionTask: null, personas: [], timeline: [], goal: 'цель',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.claims, [], 'AUDIT_CONTRADICTIONS is off by default');
    const user = (last().messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.equal(user.includes('"claims"'), false, 'claims are not asked for');
    assert.deepEqual(r.issues.map((i) => [i.title, i.audience]), [['аудитория', 'depositors'], ['жаргон', undefined]]);
  });

  test('claim directions map by stem; a number maps to nothing', () => {
    assert.deepEqual(['продолжают расти', 'не растут', 'замедлится', 'снизились', '68,4%'].map(llm.claimDirection),
      ['растёт', 'стабилизировалось', 'замедляется', 'снижается', null]);
  });
});

describe('the persona reads the whole document', () => {
  test('a marker at the end of a 15-page document reaches the prompt', async () => {
    reply = 'Реплика.';
    const doc = 'Начало документа. ' + 'Абзац нормативного текста. '.repeat(2_600) + 'МАРКЕР_КОНЦА_ДОКУМЕНТА';
    assert.ok(doc.length > 60_000, 'about fifteen pages');
    await llm.generatePersonaResponse(persona, doc, []);
    const messages = last().messages as { role: string; content: string }[];
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    assert.ok(user.includes('МАРКЕР_КОНЦА_ДОКУМЕНТА'), 'the end of the document is in the prompt');
  });

  test('with a long document the transcript gives way and the document does not', async () => {
    reply = 'Реплика.';
    const doc = 'Д'.repeat(95_000) + 'КОНЕЦ';
    const history = Array.from({ length: 60 }, (_, i) => ({ speaker: `P${i}`, text: `реплика ${i} ` + 'x'.repeat(500) }));
    await llm.generatePersonaResponse(persona, doc, history);
    const user = (last().messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.ok(user.includes('КОНЕЦ'), 'document intact');
    assert.ok(user.includes('реплика 59 '), 'the newest reply survives');
    assert.ok(!user.includes('реплика 0 '), 'the oldest replies were dropped');
  });
});

describe('a failed section does not throw', () => {
  test('no JSON in the answer → ok: false with a reason', async () => {
    reply = 'не JSON';
    const r = await llm.generateSectionAudit({
      order: 2, total: 3, heading: null, text: 'текст', outline: ['a', 'b', 'c'],
      documentText: 'текст', discussionTask: null, personas: [], timeline: [], goal: 'цель',
    });
    assert.equal(r.ok, false);
  });
});

describe('audience analysis (A1 stage 2) — three scenarios', () => {
  test('decision_reference: the flag, today\'s date, low temperature, the author hint fenced', async () => {
    reply = JSON.stringify({ section: '1. Решение', quote: 'Ставка снижена до 16,25%.',
      actor: { value: 'central_bank', quote: 'Национальный Банк' }, direction: { value: 'LOWER', quote: 'снижена' }, value: { value: '16,25', quote: '16,25%' } });
    const r = await llm.generateDecisionReference('Ставка снижена до 16,25%.', ['1. Решение'], 'снижение ставки');
    const body = last();
    assertThinkingFlag(body, 'decision_reference');
    assert.equal(body.temperature, 0.1);
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.match(user, /<<<ДАННЫЕ:ГЛАВНОЕ_ПО_МНЕНИЮ_АВТОРА:/, 'the hint is untrusted data');
    assert.deepEqual(r, {
      quote: 'Ставка снижена до 16,25%.', section: '1. Решение',
      actor: { value: 'central_bank', quote: 'Национальный Банк' }, direction: { value: 'lower', quote: 'снижена' }, value: { value: 16.25, quote: '16,25%' },
    });
  });

  test('decision_verdict@4 extracts only: no reference in the prompt; unknown and repeated ids dropped; an unknown value is «не указано»', async () => {
    reply = JSON.stringify({ answers: [
      { id: 'R1', named: true, actor: 'banks', direction: 'lower', value: 16.25 },
      { id: 'R1', named: false, actor: null, direction: null, value: null },
      { id: 'R2', named: 'true', actor: 'Нацбанк', direction: 'down', value: null },
      { id: 'R9', named: true, actor: null, direction: 'lower', value: null },
    ] });
    const v = await llm.extractDecisions([{ id: 'R1', text: 'Банки снизили ставку до 16,25%' }, { id: 'R2', text: 'снизили' }]);
    const body = last();
    assertThinkingFlag(body, 'decision_verdict');
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.equal(/РЕШЕНИЕ_ПО_ДОКУМЕНТУ|correct|wrong/.test(user), false, 'nothing to judge against, no verdict words');
    assert.deepEqual([...v!.entries()], [
      ['R1', { named: true, actor: 'banks', direction: 'lower', value: 16.25 }],
      ['R2', { named: true, actor: null, direction: null, value: null }],
    ]);
  });

  test('missing_explanations: the document is never sent, at most five items', async () => {
    reply = JSON.stringify({ items: Array.from({ length: 7 }, (_, i) => ({ missing: `пункт ${i}`, sourceIds: ['M1', 'M2'], sections: [], suggestion: 's' })) });
    const items = await llm.generateMissingExplanations('население', [
      { id: 'M1', kind: 'unclear', persona: 'участник 1', section: '1. Раздел', text: 'что с вкладами?' },
      { id: 'M2', kind: 'action', persona: 'участник 2', section: null, text: 'не понял, что делать' },
    ], 2);
    const body = last();
    assertThinkingFlag(body, 'missing_explanations');
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    assert.equal(/<<<ДАННЫЕ:ДОКУМЕНТ:/.test(user), false, 'no document block');
    assert.match(user, /не меньше двух идентификаторов/);
    assert.equal(items!.length, 5);
  });
});

describe('three versions of the text (A1 stage 3)', () => {
  const ctx = {
    sections: [{ n: 1, title: '1. Решение', text: 'Ставка снижена до 16,25%.' }, { n: 2, title: '2. Инфляция', text: 'Инфляция 12,1%.' }],
    decision: 'Направление: снижение — «О снижении»',
    intended: ['ставка снижена'],
    missing: [{ id: 'N1', missing: 'что это значит для вкладов', question: 'что с вкладами?', suggestion: '' }],
    terms: ['дезинфляция'],
  };

  test('card: the flag, the date, low temperature, everything untrusted fenced; the placeholder rule; section numbers outside the document dropped', async () => {
    reply = JSON.stringify({
      decision: [{ text: 'Национальный Банк снизил ставку до 16,25%.', sourceSections: [1, 9], placeholder: false }],
      why: [{ text: 'Инфляция замедлилась.', sourceSections: ['2'] }],
      forYou: [{ text: '[Дописать: что решение значит для вкладов — в документе этого нет]', sourceSections: [], placeholder: true }],
      next: [],
    });
    const r = await llm.generateCard(ctx);
    const body = last();
    assertThinkingFlag(body, 'rewrite_card');
    assert.equal(body.temperature, 0.2);
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    for (const block of ['РАЗДЕЛЫ_ДОКУМЕНТА', 'РЕШЕНИЕ_ПО_ДОКУМЕНТУ', 'ЧТО_ХОТЕЛ_СКАЗАТЬ_АВТОР', 'ЧЕГО_НЕ_ХВАТАЕТ_ЧИТАТЕЛЯМ', 'НЕПОНЯТНЫЕ_ТЕРМИНЫ']) {
      assert.match(user, new RegExp(`<<<ДАННЫЕ:${block}:`), block);
    }
    assert.match(user, /\[Дописать: что именно нужно сказать — в документе этого нет\]/);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.value.decision[0]!.sourceSections, [1]);
      assert.deepEqual(r.value.why[0]!.sourceSections, [2]);
    }
  });

  test('section edits: an action outside the two and an empty text are dropped', async () => {
    reply = JSON.stringify({ edits: [
      { paragraphId: 's1p1', action: 'replace', text: 'Новый текст.', reason: 'r', issueId: 'З-01', missingId: '' },
      { paragraphId: 's1p1', action: 'delete', text: 'x', reason: '', issueId: 'З-01' },
      { paragraphId: 's1p2', action: 'insert_after', text: '   ', reason: '', missingId: 'N1' },
    ] });
    const r = await llm.generateSectionEdits({ title: '1. Решение', paragraphs: [{ id: 's1p1', text: 'Текст.' }], issues: [{ id: 'З-01', severity: 'High', title: 't', quote: 'Текст.' }], missing: [] });
    assertThinkingFlag(last(), 'rewrite_section');
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.map((e) => e.action), ['replace']);
  });

  test('brief and bluf go out with the flag', async () => {
    reply = '{"main":[],"why":[],"forBusiness":[],"next":[],"figures":[{"indicator":"ставка","value":"16,25%","section":7}]}';
    const b = await llm.generateBrief(ctx);
    assertThinkingFlag(last(), 'rewrite_brief');
    assert.ok(b.ok);
    if (b.ok) assert.equal(b.value.figures[0]!.section, null, 'a section outside the document');
    reply = '{"bluf":[{"text":"Национальный Банк снизил ставку до 16,25%.","sourceSections":[1]}]}';
    await llm.generateBluf(ctx);
    assertThinkingFlag(last(), 'rewrite_bluf');
  });
});
