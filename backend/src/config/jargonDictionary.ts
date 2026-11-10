// Dictionary of monetary-policy and financial-stability terms (A1 stage 1).
//
// ЧЕРНОВИК ДЛЯ ЭКСПЕРТА. Collected from the documents the audit was measured on
// (test1, test2, the NBK monetary policy reports of February and August 2026,
// the press release of 04.09.2026) and checked against them: every term has at
// least one hit there (scripts/measure/14-jargon.ts; four with none were removed); the
// selection, the canonical wording and the boundary between a term and an
// ordinary word are a specialist's call, not settled here.
//
// What it is for: criterion 6 of the persona scores. The code finds these terms
// in each section (services/jargon.ts) and hands the list to the persona, who
// marks the ones she does not understand; the score is computed from that
// (config/scoringScale.ts → termsScore). Words a persona calls unclear that are
// not here are kept apart as candidates for this dictionary.
//
// Form syntax: words separated by spaces; a word ending in "*" matches any
// ending ("нейтральн* ставк*" finds "нейтральной ставки"); without "*" the word
// must match whole. A hyphen also matches a hyphen followed by a line break, as
// PDF text leaves it ("денежно-\nкредитной"). Case and ё/е are ignored. Word
// boundaries are Unicode-aware (\p{L}), not \b, which does not see Cyrillic.

export interface JargonTerm {
  /** How the term is shown to the persona and in the report. */
  canonical: string;
  /** Search forms, in the syntax above. */
  forms: string[];
}

export const JARGON_DICTIONARY: readonly JargonTerm[] = [
  // ── Inflation and monetary policy ──────────────────────────
  { canonical: 'дезинфляция', forms: ['дезинфляц*'] },
  { canonical: 'проинфляционный', forms: ['проинфляцион*'] },
  { canonical: 'базовая инфляция', forms: ['базов* инфляц*'] },
  { canonical: 'инфляционные ожидания', forms: ['инфляционн* ожидани*'] },
  { canonical: 'заякоренность ожиданий', forms: ['заякорен*', 'незаякорен*', 'якор* ожидани*'] },
  { canonical: 'инфляционное таргетирование', forms: ['инфляционн* таргетир*', 'таргетировани*'] },
  { canonical: 'импортируемая инфляция', forms: ['импортируем* инфляц*', 'внешн* инфляц*'] },
  { canonical: 'вторичные эффекты', forms: ['вторичн* эффект*'] },
  { canonical: 'регулируемые цены', forms: ['регулируем* цен*'] },
  { canonical: 'очистка от сезонности', forms: ['очистк* от сезонн*', 'сезонно сглаженн*'] },
  { canonical: 'ценовая стабильность', forms: ['ценов* стабильност*'] },
  { canonical: 'денежно-кредитные условия', forms: ['денежно-кредитн* услови*'] },
  { canonical: 'жёсткость денежно-кредитной политики', forms: ['жесткост* денежно-кредитн*', 'умеренно жестк*', 'накопленн* жесткост*'] },
  { canonical: 'нейтральная ставка', forms: ['нейтральн* ставк*', 'нейтральн* уров* ставк*'] },
  { canonical: 'процентный коридор', forms: ['процентн* коридор*', 'коридор* базов* ставк*'] },
  { canonical: 'трансмиссионный механизм', forms: ['трансмиссион*', 'трансмисси*'] },
  { canonical: 'монетарные факторы', forms: ['монетарн*'] },
  { canonical: 'прогнозный раунд', forms: ['прогнозн* раунд*'] },

  // ── Money market and liquidity ─────────────────────────────
  { canonical: 'структурная ликвидность', forms: ['структурн* ликвидност*', 'структурн* профицит*'] },
  { canonical: 'изъятие ликвидности', forms: ['изъяти* ликвидност*'] },
  { canonical: 'TONIA', forms: ['TONIA'] },
  { canonical: 'операции репо', forms: ['репо'] },
  { canonical: 'ноты Национального Банка', forms: ['нот* Национальн* Банк*', 'краткосрочн* нот*'] },
  { canonical: 'минимальные резервные требования', forms: ['минимальн* резервн* требовани*', 'МРТ'] },
  { canonical: 'государственные ценные бумаги (ГЦБ)', forms: ['ГЦБ', 'государственн* ценн* бумаг*'] },
  { canonical: 'кривая доходности', forms: ['крив* доходност*'] },
  { canonical: 'спред', forms: ['спред*'] },
  { canonical: 'долларизация', forms: ['долларизац*'] },

  // ── Macroeconomics and the external sector ─────────────────
  { canonical: 'разрыв выпуска', forms: ['разрыв* выпуск*'] },
  { canonical: 'потенциальный выпуск', forms: ['потенциальн* выпуск*', 'потенциальн* ВВП', 'потенциальн* уровн*'] },
  { canonical: 'квазифискальный', forms: ['квазифискальн*'] },
  { canonical: 'фискальный импульс', forms: ['фискальн* импульс*'] },
  { canonical: 'фискальная консолидация', forms: ['фискальн* консолидац*'] },
  { canonical: 'ненефтяной дефицит', forms: ['ненефтян* дефицит*'] },
  { canonical: 'текущий счёт', forms: ['текущ* счет*'] },
  { canonical: 'платёжный баланс', forms: ['платежн* баланс*'] },
  { canonical: 'эффективный обменный курс', forms: ['эффективн* обменн* курс*', 'эффективн* курс*'] },
  { canonical: 'индекс потребительских цен (ИПЦ)', forms: ['ИПЦ', 'индекс* потребительск* цен*'] },

  // ── Financial stability and banking ────────────────────────
  { canonical: 'макропруденциальный', forms: ['макропруденциальн*'] },
  { canonical: 'пруденциальные нормативы', forms: ['пруденциальн*'] },
  { canonical: 'системный риск', forms: ['системн* риск*'] },
  { canonical: 'стресс-тестирование', forms: ['стресс-тест*'] },
  { canonical: 'достаточность капитала', forms: ['достаточност* капитал*', 'достаточност* основн* капитал*', 'достаточност* собственн* капитал*'] },
  { canonical: 'норматив k1-2', forms: ['k1-2', 'k1', 'k2'] },
  { canonical: 'активы, взвешенные по риску', forms: ['взвешенн* по риск*'] },
  { canonical: 'буфер капитала', forms: ['буфер* капитал*', 'буфер* консервации'] },
  { canonical: 'контрициклический буфер', forms: ['контрициклическ* буфер*'] },
  { canonical: 'провизии (РВПС)', forms: ['РВПС', 'провизи*', 'резерв* на возможн* потер*'] },
  { canonical: 'неработающие займы (NPL)', forms: ['NPL', 'неработающ* займ*', 'неработающ* кредит*'] },
  { canonical: 'третья стадия обесценения (Stage 3)', forms: ['Stage 3', 'стади* обесценени*'] },
  { canonical: 'норматив LCR', forms: ['LCR'] },
  { canonical: 'норматив NSFR', forms: ['NSFR'] },
  { canonical: 'коэффициент долговой нагрузки (КДН)', forms: ['КДН', 'коэффициент* долгов* нагрузк*'] },
  { canonical: 'показатель долговой нагрузки (ПДН)', forms: ['ПДН', 'показател* долгов* нагрузк*'] },
  { canonical: 'отношение кредита к залогу (LTV)', forms: ['LTV', 'отношени* сумм* ипотечн* займ* к стоимост* залог*'] },
  { canonical: 'беззалоговое кредитование', forms: ['беззалогов*'] },
  { canonical: 'реструктуризация займов', forms: ['реструктуризац*', 'реструктурированн*'] },
  { canonical: 'рентабельность капитала (ROE)', forms: ['ROE', 'рентабельност* капитал*'] },
  { canonical: 'чистая процентная маржа', forms: ['чист* процентн* марж*'] },
  { canonical: 'стоимость фондирования', forms: ['фондировани*'] },
  { canonical: 'банки второго уровня (БВУ)', forms: ['БВУ', 'банк* втор* уровн*'] },
  { canonical: 'микрофинансовые организации (МФО)', forms: ['МФО', 'микрофинансов* организац*'] },
] as const;
