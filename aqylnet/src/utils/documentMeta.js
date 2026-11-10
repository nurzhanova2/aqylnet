// The document fields (A1 stage 2): its type, date and the audience it was
// written for. The keys are the backend's (project.validator.ts DOC_TYPES,
// config/personaGroups.ts); the labels are product wording.
//
// The default audience per type lives here and only here: the server stores
// whatever the client sends, and the author edits the default before saving.

export const DOC_TYPES = [
  ['press_release', 'Пресс-релиз'],
  ['mpr', 'Доклад о ДКП'],
  ['fsr', 'Отчёт о финансовой стабильности'],
  ['analytical_note', 'Аналитическая записка'],
  ['other', 'Другое'],
];

/** Audience a type suggests. A note and «other» suggest nothing. */
export const DEFAULT_AUDIENCE = {
  press_release: ['population', 'business'],
  mpr: ['business', 'experts'],
  fsr: ['experts'],
};

export function docTypeLabel(type) {
  return DOC_TYPES.find(([k]) => k === type)?.[1] ?? null;
}

/** The audience after choosing `type`: its default, or the current one when it has none. */
export function audienceForType(type, current) {
  return DEFAULT_AUDIENCE[type] ? [...DEFAULT_AUDIENCE[type]] : current;
}

/** '2026-09-04' → '04.09.2026'; anything else as is. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? '');
}

/** «Пресс-релиз · 04.09.2026» for the report header; '' when neither is set. */
export function documentMetaLine(meta) {
  // «Другое» is a valid choice in the form but tells the reader nothing in a
  // header («ОТЧЁТ · … · ДРУГОЕ · 04.11.2026»): the line names only a real type.
  const type = meta?.docType && meta.docType !== 'other' ? docTypeLabel(meta.docType) : null;
  return [type, meta?.publishedAt ? fmtDate(meta.publishedAt) : null].filter(Boolean).join(' · ');
}

/** The fields as the API takes them: an empty audience is «not set» — null. */
export function metaPayload({ docType, publishedAt, intendedAudience }) {
  return {
    docType: docType || null,
    publishedAt: publishedAt || null,
    intendedAudience: intendedAudience?.length ? intendedAudience : null,
  };
}
