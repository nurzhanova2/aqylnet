// A script copy of the generateDocumentAudit prompt (llm.service.ts:1061), so the
// audit can be measured on inputs the product does not send — one section, the
// whole document — without touching the product.
//
// The prompt text is copied verbatim; everything around it is imported from the
// compiled backend in the container (/app/dist), so fencing, jurisdiction
// grounding, transcript budgeting, JSON repair and quote checking are the
// product's own code, not a lookalike. Only `docSlice` differs: the product
// hard-codes documentText.slice(0, 6000), here the caller chooses.
//
// The request carries the same parameters the product sends: temperature 0.3,
// thinking disabled through `extra_body` (shown by 04-thinking-flag.mjs to reach
// vLLM via LiteLLM), max_tokens from the caller.

import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const safety = require('/app/dist/services/promptSafety.js');
const llm = require('/app/dist/services/llm.service.js');

export const { parseTruncatedJson, transcriptWithinBudget } = llm;
export const { isVerbatimQuote } = safety;

const AUDIT_CATEGORIES = ['readability', 'terminology', 'ambiguity', 'context', 'logic', 'evidence', 'data', 'structure', 'audience'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

// Taken from the product rather than retyped: an earlier version of this file
// had its own wording ("…и уязвимостей"), a few tokens off what report.service
// sends for risk_search. Steps 6 and 5(c) ran with that wording.
export const GOAL_RISK = llm.GOAL_LABELS.risk_search;

/**
 * @param {object} o
 * @param {string} o.docSlice     the document text placed in the prompt
 * @param {string} o.fullText     the whole document (jurisdiction detection reads it, as in the product)
 * @param {string|null} o.task
 * @param {{name:string,role:string,stance:string}[]} o.personas
 * @param {{speaker:string,text:string}[]} o.timeline
 * @param {string} o.goal
 * @param {string[]} o.intendedMessages
 */
export function buildAuditMessages({ docSlice, fullText, task = null, personas = [], timeline = [], goal = GOAL_RISK, intendedMessages = [] }) {
  const personaList = personas.map((p) => `${p.name} (${p.role}) — позиция: ${p.stance || 'не задана'}`).join('\n');
  const transcript = transcriptWithinBudget(timeline);
  const t = task?.trim();
  const grounding = llm.jurisdictionGrounding([t, fullText].filter(Boolean).join('\n'));
  const sideContext = [t ? 'ЗАДАЧА, ПОСТАВЛЕННАЯ ГРУППЕ (не часть документа): ' + t : '', grounding].filter(Boolean).join('\n\n');

  const intendedBlock = intendedMessages.length > 0
    ? '\n\nКЛЮЧЕВЫЕ СООБЩЕНИЯ, КОТОРЫЕ АВТОР ХОТЕЛ ДОНЕСТИ:\n' + intendedMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '';
  const alignmentSpec = intendedMessages.length > 0
    ? '  "alignment": [' + intendedMessages
        .map((m) => `{"message": ${JSON.stringify(m)}, "score": 0-100 — насколько точно участники поняли именно это сообщение, "perceived": "как это сообщение реально поняли участники (1-2 предложения)", "verdict": "понято" | "понято частично" | "понято неверно"}`)
        .join(',\n    ') + '],'
    : '  "alignment": [],';

  const fenceTag = safety.newFenceTag();
  const prompt = `${safety.wrapUntrusted('ДОКУМЕНТ', docSlice, fenceTag)}

ЦЕЛЬ ОБСУЖДЕНИЯ: ${goal}${sideContext ? '\n\n' + sideContext : ''}

${safety.wrapUntrusted('УЧАСТНИКИ', personaList, fenceTag)}

${safety.wrapUntrusted('СТЕНОГРАММА', transcript || '(обсуждение пустое)', fenceTag)}${intendedBlock}

Верни ТОЛЬКО JSON-объект (без пояснений и markdown-разметки):

{
  "sections": [
    {"title": "название смыслового блока документа", "clarity": 0-100, "note": "что именно в этом блоке затрудняет понимание"}
  ],
  "issues": [
    {
      "title": "суть замечания — одно предложение",
      "category": "одна из категорий: ${AUDIT_CATEGORIES.join(' | ')}",
      "severity": "одна из: ${SEVERITIES.join(' | ')}",
      "quote": "дословная цитата из ДОКУМЕНТА (не из стенограммы), к которой относится замечание, до 200 символов; пустая строка, если замечание про документ в целом",
      "raisedBy": "имена участников, которые это подняли, через запятую",
      "agreedBy": "имена участников, которые согласились, через запятую (пустая строка, если никто)",
      "disputedBy": "имена участников, которые возразили или трактовали иначе, через запятую (пустая строка, если никто)"
    }
  ],
  "scores": [
    {"key": "clarity",     "label": "Ясность",          "value": 0-100, "note": "одно предложение — почему такая оценка"},
    {"key": "evidence",    "label": "Доказательность",  "value": 0-100, "note": "..."},
    {"key": "relevance",   "label": "Релевантность",    "value": 0-100, "note": "..."},
    {"key": "trust",       "label": "Доверие",          "value": 0-100, "note": "..."}
  ],
${alignmentSpec}
}

Требования:
- Заполняй поля строго в указанном порядке: сначала sections и issues (разбор), и только потом scores. Оценки по осям должны опираться на уже перечисленные тобой замечания, а не предшествовать им.
- scores выставляй так, чтобы они были согласованы с найденными замечаниями: если по какой-то оси ты нашёл Critical/High issues, высокий балл по ней невозможен.
- 5-8 issues. Severity ставь по риску неправильного понимания документа, а не по эмоциональности реплик.
- quote бери ДОСЛОВНО из текста документа выше, не перефразируй. Если точной цитаты нет — пустая строка.
- disputedBy заполняй только если в стенограмме реально есть возражение или другая трактовка.
- 6-8 sections: раздели на последовательные смысловые блоки ТОЛЬКО текст документа. Не включай в карту задачу группы, контекст юрисдикции, цель обсуждения или стенограмму — это не части документа.
- Всё на русском языке. Опирайся только на документ и реально сказанное в стенограмме, не выдумывай.`;

  return [
    { role: 'system', content: 'Ты — методолог, который проводит аудит документа по результатам обсуждения в фокус-группе. Твоя задача — не пересказать дискуссию, а оценить сам документ: насколько он понятен, доказателен и однозначен для этих аудиторий.\n\n' + safety.untrustedDataRules(fenceTag) },
    { role: 'user', content: prompt },
  ];
}

export function auditBody(messages, maxTokens) {
  return { messages, max_tokens: maxTokens, temperature: 0.3, extra_body: { chat_template_kwargs: { enable_thinking: false } } };
}

/**
 * What the product would make of a completion: strict JSON, repaired JSON, and
 * how many issue quotes are verbatim in the document they were drawn from.
 */
export function judgeAudit(content, documentText) {
  const start = content.indexOf('{');
  const body = start < 0 ? '' : content.slice(start);
  let strict = false;
  try { JSON.parse(body.replace(/```\s*$/, '').trim()); strict = true; } catch { /* not strict */ }
  const parsed = body ? parseTruncatedJson(body) : null;
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const quoted = issues.filter((i) => String(i?.quote ?? '').trim().length > 0);
  const verified = quoted.filter((i) => isVerbatimQuote(String(i.quote), documentText));
  return {
    jsonStrict: strict,
    jsonRepaired: !!parsed,
    sections: Array.isArray(parsed?.sections) ? parsed.sections.length : 0,
    issues: issues.length,
    scores: Array.isArray(parsed?.scores) ? parsed.scores.length : 0,
    quotes: quoted.length,
    quotesVerbatim: verified.length,
    scoreValues: Array.isArray(parsed?.scores) ? parsed.scores.map((s) => s?.value) : [],
  };
}
