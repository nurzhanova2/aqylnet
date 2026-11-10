// Deterministic regression test for BUG-2:
// the LLM-computed per-document persona stance was structurally unreachable
// because SetupPage always sent an explicit personaStances entry for every
// selected persona. That frontend fix is covered by an e2e test
// (tests/e2e/defects.test.mjs) that inspects the actual POST /projects
// payload. This file covers the other half of the pipeline — once a stance
// value (explicit or LLM-computed) is resolved and attached to a persona
// object, does it actually reach the prompt sent to the LLM? — without
// depending on a live, non-deterministic LLM call.
//
// Run with: npx tsx --test src/services/llm.service.stance.test.ts   (from backend/)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonaSystemPrompt, PersonaForLLM } from './llm.service';

function basePersona(overrides: Partial<PersonaForLLM> = {}): PersonaForLLM {
  return {
    name: 'Тестовая Персона',
    role: 'Тестовая роль',
    style: 'Аналитический',
    criticality: 'Средний',
    behaviorModel: 'Наблюдатель',
    reasoning: 'базовое рассуждение',
    thinking: 'базовая мысль',
    stance: 'Нейтральный',
    priority: 'базовый приоритет',
    fears: 'базовое опасение',
    speechTone: 'спокойный',
    argumentation: 'фактологическая',
    responseLength: 'Средний',
    typicalPhrases: 'как я вижу',
    interests: ['экономика'],
    city: 'Алматы',
    education: 'высшее',
    industry: 'финансы',
    employerType: 'частный',
    income: 'средний',
    openness: 'умеренная',
    decisionMaking: 'рациональное',
    personalSituation: 'нет особых обстоятельств',
    ...overrides,
  };
}

describe('buildPersonaSystemPrompt — stance propagation (BUG-2)', () => {
  test('a computed/overridden stance value is present verbatim in the generated prompt', () => {
    const prompt = buildPersonaSystemPrompt(basePersona({ stance: 'Против' }));
    assert.match(prompt, /Общая позиция: Против/);
  });

  test('a different stance value produces a different prompt (no hardcoded fallback swallowing it)', () => {
    const promptSupports = buildPersonaSystemPrompt(basePersona({ stance: 'Поддерживает' }));
    const promptAgainst  = buildPersonaSystemPrompt(basePersona({ stance: 'Против' }));
    assert.notEqual(promptSupports, promptAgainst);
    assert.match(promptSupports, /Общая позиция: Поддерживает/);
    assert.match(promptAgainst, /Общая позиция: Против/);
  });

  test('two personas with different stances get independent prompts — no cross-contamination', () => {
    const personaA = basePersona({ name: 'Алия', stance: 'Поддерживает' });
    const personaB = basePersona({ name: 'Максат', stance: 'Против' });
    const promptA = buildPersonaSystemPrompt(personaA);
    const promptB = buildPersonaSystemPrompt(personaB);

    // Asserts the identity is carried, not the sentence that carries it. The
    // wording changed in stage E6: the persona profile moved into a fenced data
    // block, so "Ты — Алия, роль." became "Имя: Алия". The substance under test
    // — stance precedence and no cross-contamination — is unaffected.
    assert.match(promptA, /Имя: Алия/);
    assert.match(promptA, /Общая позиция: Поддерживает/);
    assert.doesNotMatch(promptA, /Общая позиция: Против/);

    assert.match(promptB, /Имя: Максат/);
    assert.match(promptB, /Общая позиция: Против/);
    assert.doesNotMatch(promptB, /Общая позиция: Поддерживает/);
  });

  test('the same persona used across two different simulated projects can carry different stance values (project-specific override, not a global mutation)', () => {
    // Simulates iteration.service.ts's per-project merge:
    // { ...pp.persona, ...(pp.stanceOverride && { stance: pp.stanceOverride }) }
    // — the persona's own library-wide default is untouched; only the merged
    // copy used for this one project's prompt differs.
    const libraryDefault = basePersona({ name: 'Гульнар', stance: 'Нейтральный' });

    const projectOnePersona = { ...libraryDefault, stance: 'Поддерживает' }; // explicit override in project 1
    const projectTwoPersona = { ...libraryDefault, stance: 'Против' };       // different override in project 2

    const promptProject1 = buildPersonaSystemPrompt(projectOnePersona);
    const promptProject2 = buildPersonaSystemPrompt(projectTwoPersona);

    assert.match(promptProject1, /Общая позиция: Поддерживает/);
    assert.match(promptProject2, /Общая позиция: Против/);
    // The original library object itself must remain untouched by either merge.
    assert.equal(libraryDefault.stance, 'Нейтральный');
  });

  test('an absent computed stance falls back to a safe non-empty value, never "undefined" in the prompt', () => {
    // Mirrors iteration.service.ts's merge guard: `pp.stanceOverride && {...}`
    // means a null/empty override leaves persona.stance as whatever the
    // caller already resolved it to (persona's own default) — this asserts
    // that path never lets a literal `undefined` leak into the prompt text.
    function resolveStance(override: string | null): string {
      return override || 'Нейтральный';
    }
    const persona = basePersona({ stance: resolveStance(null) });
    const prompt = buildPersonaSystemPrompt(persona);
    assert.doesNotMatch(prompt, /undefined/);
    assert.match(prompt, /Общая позиция: Нейтральный/);
  });

  test('unrelated persona fields are not affected by changing only the stance', () => {
    const personaDefault  = basePersona();
    const personaOverride = basePersona({ stance: 'Против' });
    const promptDefault  = buildPersonaSystemPrompt(personaDefault);
    const promptOverride = buildPersonaSystemPrompt(personaOverride);

    // Same name/role/etc. — only the "ПОЗИЦИЯ ПО ОБСУЖДАЕМОЙ ТЕМЕ" block differs.
    assert.match(promptDefault, /Имя: Тестовая Персона[\s\S]*Роль: Тестовая роль/);
    assert.match(promptOverride, /Имя: Тестовая Персона[\s\S]*Роль: Тестовая роль/);
    assert.equal(
      promptDefault.split('ПОЗИЦИЯ ПО ОБСУЖДАЕМОЙ ТЕМЕ')[0],
      promptOverride.split('ПОЗИЦИЯ ПО ОБСУЖДАЕМОЙ ТЕМЕ')[0],
      'everything before the stance section must be identical when only stance changes',
    );
  });
});
