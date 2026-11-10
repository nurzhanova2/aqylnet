// Client-side PDF/Word export built from AnalyticsReportDTO (see api/analytics.js).
// pdfmake is used for PDF because its bundled Roboto font renders Cyrillic correctly —
// jsPDF's built-in fonts do not support Cyrillic glyphs at all.

import {
  ALT_DISCLAIMER, QUOTE_UNVERIFIED, ABSENCE_NOTE, CONTRADICTION_LABEL, issueHeading,
  TRUST_NOT_CHECKED, DIRECTIVES_TITLE, DIRECTIVES_NOTE, altTagLabel, sectionLine,
} from './reportTrust';
import { buildPersonaScoresModel } from './personaScoresModel';
import { audienceExportLines } from './audienceModel';
import { rewriteExportModel } from './rewriteModel';
import { documentMetaLine } from './documentMeta';

// Exported for exportReport.test.js. Both exporters go through it, so a test
// on this one function covers the PDF and the DOCX at once — and what it
// guards is that the verification marks survive into the file that leaves the
// product, which is easy to lose in a later edit and impossible to notice.
// `document` — { docType, publishedAt } from the audience analysis (A1 stage 2),
// shown in the header line next to the title.
export function buildReportModel(analytics, document = null) {
  const {
    projectTitle, projectSubtitle, personaCount, iterations, mode,
    mood, moodDescription,
    conclusions, topicBars, risks, positives, recommendations, altParagraphs,
    overallScore, scores, sections, issues, alignment,
    directives, trustChecked,
  } = analytics;

  return {
    title: projectTitle || 'Отчёт по дискуссии',
    meta: [documentMetaLine(document), projectSubtitle, `${personaCount} участников`, `${iterations} итераций`, `режим ${mode}`]
      .filter(Boolean)
      .join(' · '),
    moodLine: mood || '',
    moodDescription: moodDescription || '',
    conclusions: (conclusions || []).map((c) => `${c.n}. ${c.text}`),
    topics: (topicBars || []).map((t) => `${t.name} — ${t.pct}%`),
    // Copied, not aliased: pdfmake mutates every array and string node handed to
    // it during layout (a plain string becomes {text, _margin, _inlines, …}), so
    // sharing the component's state array here corrupts it and the next React
    // render throws "Objects are not valid as a React child".
    risks: [...(risks || [])],
    positives: (positives || []).map((p) => `${p.text} (поддержали: ${p.by})`),
    recommendations: [...(recommendations || [])],
    // The exported file is the copy that leaves the product and is read by
    // people who never saw the page, so the marks the page shows have to
    // survive here — and this block is the one that looks most like a finished
    // document.
    altParagraphs: (altParagraphs || []).map((a) => `[${altTagLabel(a)}] ${a.text}`),
    altDisclaimer: (altParagraphs || []).length > 0 ? ALT_DISCLAIMER.trim() : '',

    // Document audit block. Empty for reports generated before the audit pass
    // existed — every consumer below skips a section whose list is empty.
    scoreLine: overallScore == null ? '' : `Качество документа: ${overallScore} / 100`,
    scores: (scores || []).map((s) => `${s.label}: ${s.value} / 100${s.note ? ` — ${s.note}` : ''}`),
    // A section whose audit failed is exported as such — the reader of the file
    // must see what was not looked at (reportTrust.sectionLine).
    sections: (sections || []).map(sectionLine),
    issues: (issues || []).map((i) => {
      const cat = i.kind === 'contradiction' ? CONTRADICTION_LABEL : i.category;
      const parts = [`${i.code} [${i.severity} · ${cat}] ${issueHeading(i)}`];
      if (i.kind === 'absence') parts.push(ABSENCE_NOTE);
      const quote = (q, verified, where) => {
        const at = where ? `${where}: ` : '';
        return verified === false ? `Цитата: ${at}«${q}» (${QUOTE_UNVERIFIED})` : `Цитата: ${at}«${q}»`;
      };
      if (i.quote) parts.push(quote(i.quote, i.quoteVerified, i.kind === 'contradiction' ? i.section : ''));
      if (i.kind === 'contradiction' && i.quote2) parts.push(quote(i.quote2, i.quote2Verified, i.section2));
      if (i.raisedBy)   parts.push(`Поднял: ${i.raisedBy}`);
      if (i.agreedBy)   parts.push(`Согласны: ${i.agreedBy}`);
      if (i.disputedBy) parts.push(`Спорят: ${i.disputedBy}`);
      return parts.join(' | ');
    }),
    alignment: (alignment || []).map((a) =>
      `${a.score}% «${a.message}»${a.verdict ? ` — ${a.verdict}` : ''}${a.perceived ? `. Поняли так: ${a.perceived}` : ''}`
    ),

    // Verification marks, same wording as the page (utils/reportTrust.js).
    directivesTitle: (directives || []).length > 0 ? DIRECTIVES_TITLE : '',
    directivesNote: (directives || []).length > 0 ? DIRECTIVES_NOTE : '',
    directives: (directives || []).map((d) => `${d.source} · ${d.kind}: «${d.excerpt}»`),
    trustNote: trustChecked === false ? TRUST_NOT_CHECKED : '',
  };
}

function fileBaseName(title) {
  const slug = (title || 'otchet')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'otchet';
}

// The export libraries are loaded on first use, not with the page: pdfmake and
// its fonts alone are ~2 MB.
async function loadPdfMake() {
  const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts;
  return pdfMake;
}

async function loadDocx() {
  const [docx, { saveAs }] = await Promise.all([import('docx'), import('file-saver')]);
  return { ...docx, saveAs };
}

export async function exportReportToPdf(analytics, personaScores = null, audience = null) {
  const pdfMake = await loadPdfMake();

  const m = buildReportModel(analytics, audience?.document);
  const au = audienceExportLines(audience);
  // Persona scores (A1 stage 1) travel with the file: whoever reads the PDF
  // never saw the page.
  const ps = buildPersonaScoresModel(personaScores);
  const section = (heading) => ({ text: heading, style: 'sectionHeading', margin: [0, 14, 0, 6] });
  const sub = (heading) => ({ text: heading, style: 'body', bold: true, margin: [0, 8, 0, 4] });
  // Copy again at the single chokepoint, so a future field that forgets to map()
  // can't leak a live array into pdfmake's mutating layout pass.
  const bulletList = (items) => (items.length ? { ul: [...items], margin: [0, 0, 0, 4] } : null);

  const content = [
    { text: m.title, style: 'title' },
    { text: m.meta, style: 'meta', margin: [0, 2, 0, 12] },

    // Before the analysis, not appended at the end: it changes how everything
    // after it should be read.
    m.directivesTitle ? { text: m.directivesTitle, style: 'warnHeading', margin: [0, 0, 0, 4] } : null,
    m.directivesNote ? { text: m.directivesNote, style: 'bodyMuted', margin: [0, 0, 0, 4] } : null,
    bulletList(m.directives),
    m.trustNote ? { text: m.trustNote, style: 'bodyMuted', margin: [0, 0, 0, 8] } : null,

    section('Общее настроение'),
    { text: m.moodLine || '—', style: 'body' },
    m.moodDescription ? { text: m.moodDescription, style: 'bodyMuted', margin: [0, 2, 0, 0] } : null,

    m.scoreLine ? section('Оценка документа') : null,
    m.scoreLine ? { text: m.scoreLine, style: 'body' } : null,
    bulletList(m.scores),

    m.issues.length ? section('Замечания к документу') : null,
    bulletList(m.issues),

    m.alignment.length ? section('Задумано и понято') : null,
    bulletList(m.alignment),

    ...(ps ? [
      section(ps.title),
      { text: ps.note, style: 'bodyMuted', margin: [0, 0, 0, 6] },
      { text: ps.shares, style: 'body', margin: [0, 0, 0, 4] },
      { text: ps.unanswered, style: 'body', margin: [0, 0, 0, 4] },
      sub('Главные расхождения групп'), bulletList(ps.top),
      ps.topTerms ? { text: ps.topTerms, style: 'body', margin: [0, 0, 0, 4] } : null,
      sub('Группы — документ в целом'), bulletList([...ps.groups, ps.gapLine, ps.spreadLine]),
      sub('Участники — документ в целом'), bulletList([...ps.personas, ps.documentLine]),
      sub('Разделы — среднее участников'), bulletList(ps.sections),
      sub('Что понял каждый'), bulletList(ps.readings),
    ] : []),

    // «Кому понятен текст» (A1 stage 2), right after the persona scores, as on the page.
    ...(au && ps ? [
      section(au.title),
      ...au.headline.map((h, i) => ({ text: h, style: i === 0 ? 'body' : 'bodyMuted', bold: i === 0, margin: [0, 0, 0, 4] })),
      au.stale ? { text: au.stale, style: 'warnHeading', fontSize: 10.5, margin: [0, 0, 0, 4] } : null,
      au.notRun ? { text: au.notRun, style: 'bodyMuted', margin: [0, 0, 0, 4] } : null,
      sub('Группы'), bulletList(au.groups),
      ...(au.reference ? [sub('Как поняли решение'), { text: au.reference, style: 'body', margin: [0, 0, 0, 4] }, bulletList(au.verdicts)] : []),
      ...(au.missing.length ? [sub('Чего не хватает'), ...au.missing.flatMap((g) => [{ text: g.label, style: 'body', italics: true, margin: [0, 4, 0, 2] }, bulletList(g.lines)])] : []),
    ] : []),

    m.sections.length ? section('Карта документа') : null,
    bulletList(m.sections),

    section('Основные выводы'),
    ...m.conclusions.map((line) => ({ text: line, style: 'body', margin: [0, 0, 0, 4] })),

    section('Наиболее обсуждаемые темы'),
    bulletList(m.topics),

    section('Потенциальные риски'),
    bulletList(m.risks),

    section('Положительные стороны'),
    bulletList(m.positives),

    section('Рекомендации'),
    bulletList(m.recommendations),

    section('Альтернативная редакция'),
    m.altDisclaimer ? { text: m.altDisclaimer, style: 'bodyMuted', margin: [0, 0, 0, 6] } : null,
    bulletList(m.altParagraphs),
  ].filter(Boolean);

  const docDefinition = {
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      title: { fontSize: 18, bold: true },
      meta: { fontSize: 9.5, color: '#666666' },
      sectionHeading: { fontSize: 12.5, bold: true, color: '#1F4A36' },
      warnHeading: { fontSize: 12, bold: true, color: '#8C3A28' },
      body: { fontSize: 10.5 },
      bodyMuted: { fontSize: 10, color: '#555555', italics: true },
    },
    pageMargins: [48, 48, 48, 48],
  };

  pdfMake.createPdf(docDefinition).download(`${fileBaseName(m.title)}.pdf`);
}

export async function exportReportToDocx(analytics, personaScores = null, audience = null) {
  const { Document, Packer, Paragraph, HeadingLevel, saveAs } = await loadDocx();

  const m = buildReportModel(analytics, audience?.document);
  const au = audienceExportLines(audience);
  const ps = buildPersonaScoresModel(personaScores);
  const heading = (text) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
  const bullets = (items) => items.map((text) => new Paragraph({ text: `• ${text}`, spacing: { after: 60 } }));

  const children = [
    new Paragraph({ text: m.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: m.meta, spacing: { after: 200 } }),

    ...(m.directivesTitle
      ? [
        new Paragraph({ text: m.directivesTitle, heading: HeadingLevel.HEADING_3 }),
        new Paragraph({ text: m.directivesNote, spacing: { after: 60 } }),
      ]
      : []),
    ...bullets(m.directives),
    ...(m.trustNote ? [new Paragraph({ text: m.trustNote, spacing: { after: 120 } })] : []),

    heading('Общее настроение'),
    new Paragraph({ text: m.moodLine || '—' }),
    ...(m.moodDescription ? [new Paragraph({ text: m.moodDescription })] : []),

    ...(m.scoreLine ? [heading('Оценка документа'), new Paragraph({ text: m.scoreLine })] : []),
    ...bullets(m.scores),

    ...(m.issues.length ? [heading('Замечания к документу')] : []),
    ...bullets(m.issues),

    ...(m.alignment.length ? [heading('Задумано и понято')] : []),
    ...bullets(m.alignment),

    ...(ps ? [
      heading(ps.title),
      new Paragraph({ text: ps.note, spacing: { after: 80 } }),
      new Paragraph({ text: ps.shares, spacing: { after: 80 } }),
      new Paragraph({ text: ps.unanswered, spacing: { after: 80 } }),
      new Paragraph({ text: 'Главные расхождения групп', heading: HeadingLevel.HEADING_3 }),
      ...bullets(ps.top),
      ...(ps.topTerms ? [new Paragraph({ text: ps.topTerms, spacing: { after: 80 } })] : []),
      new Paragraph({ text: 'Группы — документ в целом', heading: HeadingLevel.HEADING_3 }),
      ...bullets([...ps.groups, ps.gapLine, ps.spreadLine]),
      new Paragraph({ text: 'Участники — документ в целом', heading: HeadingLevel.HEADING_3 }),
      ...bullets([...ps.personas, ps.documentLine]),
      new Paragraph({ text: 'Разделы — среднее участников', heading: HeadingLevel.HEADING_3 }),
      ...bullets(ps.sections),
      new Paragraph({ text: 'Что понял каждый', heading: HeadingLevel.HEADING_3 }),
      ...bullets(ps.readings),
    ] : []),

    ...(au && ps ? [
      heading(au.title),
      ...au.headline.map((text) => new Paragraph({ text, spacing: { after: 60 } })),
      ...(au.stale ? [new Paragraph({ text: au.stale, spacing: { after: 60 } })] : []),
      ...(au.notRun ? [new Paragraph({ text: au.notRun, spacing: { after: 60 } })] : []),
      new Paragraph({ text: 'Группы', heading: HeadingLevel.HEADING_3 }),
      ...bullets(au.groups),
      ...(au.reference ? [new Paragraph({ text: 'Как поняли решение', heading: HeadingLevel.HEADING_3 }), new Paragraph({ text: au.reference, spacing: { after: 60 } }), ...bullets(au.verdicts)] : []),
      ...(au.missing.length ? [new Paragraph({ text: 'Чего не хватает', heading: HeadingLevel.HEADING_3 }), ...au.missing.flatMap((g) => [new Paragraph({ text: g.label, spacing: { before: 80, after: 40 } }), ...bullets(g.lines)])] : []),
    ] : []),

    ...(m.sections.length ? [heading('Карта документа')] : []),
    ...bullets(m.sections),

    heading('Основные выводы'),
    ...m.conclusions.map((text) => new Paragraph({ text })),

    heading('Наиболее обсуждаемые темы'),
    ...bullets(m.topics),

    heading('Потенциальные риски'),
    ...bullets(m.risks),

    heading('Положительные стороны'),
    ...bullets(m.positives),

    heading('Рекомендации'),
    ...bullets(m.recommendations),

    heading('Альтернативная редакция'),
    ...(m.altDisclaimer ? [new Paragraph({ text: m.altDisclaimer, spacing: { after: 120 } })] : []),
    ...bullets(m.altParagraphs),
  ];

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName(m.title)}.docx`);
}

// ─── Three versions of the text (A1 stage 3) ─────────────────
// Each version is its own document, not a section of the report: the card
// goes to the population, the brief to journalists, the full text to experts.
// The header carries the draft note and the limitation of the checks; every
// mark and basis stays next to its phrase.

const REWRITE_FILE = { card: 'kartochka', brief: 'spravka', full: 'polnyi_tekst' };

export async function exportRewriteToPdf(rewrites, layerKey) {
  const pdfMake = await loadPdfMake();
  const m = rewriteExportModel(rewrites, layerKey, documentMetaLine(rewrites?.document));
  // Fresh nodes for pdfmake, which mutates what it lays out (see above).
  const content = [
    { text: m.title, style: 'title' },
    ...m.header.map((h, i) => ({ text: h, style: i < 2 ? 'warnNote' : 'meta', margin: [0, 4, 0, 0] })),
    m.summary ? { text: m.summary, style: 'meta', margin: [0, 6, 0, 8] } : null,
    ...m.blocks.flatMap((b) => [
      { text: b.heading, style: 'sectionHeading', margin: [0, 12, 0, 4] },
      ...b.lines.map((line) => ({ text: line, style: 'body', margin: [0, 0, 0, 4] })),
    ]),
  ].filter(Boolean);
  pdfMake.createPdf({
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      title: { fontSize: 16, bold: true },
      meta: { fontSize: 9.5, color: '#666666' },
      warnNote: { fontSize: 10, color: '#8C5A12', italics: true },
      sectionHeading: { fontSize: 12.5, bold: true, color: '#1F4A36' },
      body: { fontSize: 10.5 },
    },
    pageMargins: [48, 48, 48, 48],
  }).download(`${fileBaseName(rewrites?.document?.title)}_${REWRITE_FILE[layerKey]}.pdf`);
}

export async function exportRewriteToDocx(rewrites, layerKey) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, saveAs } = await loadDocx();
  const m = rewriteExportModel(rewrites, layerKey, documentMetaLine(rewrites?.document));
  const children = [
    new Paragraph({ text: m.title, heading: HeadingLevel.TITLE }),
    ...m.header.map((h) => new Paragraph({ children: [new TextRun({ text: h, italics: true })], spacing: { after: 60 } })),
    ...(m.summary ? [new Paragraph({ text: m.summary, spacing: { after: 160 } })] : []),
    ...m.blocks.flatMap((b) => [
      new Paragraph({ text: b.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }),
      ...b.lines.map((line) => new Paragraph({ text: line, spacing: { after: 80 } })),
    ]),
  ];
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  saveAs(blob, `${fileBaseName(rewrites?.document?.title)}_${REWRITE_FILE[layerKey]}.docx`);
}
