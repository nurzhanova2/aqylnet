import { PrismaClient } from '@prisma/client';

// Read from the environment directly rather than importing src/config/env.
//
// The seed is compiled on its own (npm run build:seed) so it can run in the
// production image, which carries no TypeScript and no dev dependencies. An
// import from ../src would drag the whole source tree into that compile and
// produce a second copy of the config module inside dist. One field is not
// worth that; the default below matches env.ts.
const LLM_MODEL = process.env.LLM_MODEL ?? 'assistant-balanced';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.persona.count();

  // Idempotency is decided by WHICH personas exist, never by how many.
  // The previous guard compared the count against 32 and 8, so deleting a
  // single persona from the library dropped the total to 31, the "add the 24
  // new ones" branch fired on the next container start, and every one of those
  // 24 was inserted a second time — the database ended up with 55 rows and 24
  // duplicate names. seedNewPersonas() now skips the personas already present,
  // which makes re-running it harmless whatever the count happens to be.
  if (existing > 0) {
    const added = await seedNewPersonas();
    console.log(added > 0
      ? `[seed] Library already populated — added ${added} missing persona(s).`
      : '[seed] Library already populated — nothing to add.');
    return;
  }

  console.log('[seed] Seeding all personas...');

  // ─── Personas (original 8) ───────────────────────────────────
  const [aliya, maksat, gulnar, daniyar, svetlana, erlan, aibek, timur] =
    await Promise.all([
      prisma.persona.create({
        data: {
          name: 'Алия', group: 'population',
          role: 'Студентка',
          gender: 'Женский',
          age: '21 год',
          dot: '#a78bff',
          seatL: '11%',
          seatT: '49%',
          thinking:
            'Кредиты и так дорогие. Если станет ещё дороже — учиться в долг будет почти нереально.',
          style: 'Эмоциональный',
          criticality: 'Средний',
          behaviorModel: 'Наблюдатель',
          interests: ['Образование', 'Доступность кредитов', 'Молодёжь'],
          reasoning:
            'Как студентка, я смотрю на это с позиции доступа к деньгам. Образовательные и потребительские кредиты для молодёжи и так под высокий процент. Если банки будут вынуждены держать больше капитала, ставки вырастут ещё, и для нас это закроет многие возможности.',
          avatarIdx: 0,
          look: { skin: '#F6D2B8', hair: '#2A1C17', style: 'long', outfit: '#7C5CC4' },
          city: 'Алматы', education: 'Высшее (в процессе)',
          industry: 'Образование', employerType: 'Студент', income: 'Низкий',
          openness: 'Прогрессивный', decisionMaking: 'Эмоциональный',
          stance: 'Против', priority: 'Доступность образовательных кредитов для молодёжи',
          fears: 'Рост ставок по кредитам для студентов',
          personalSituation: 'Учится на 4-м курсе экономического факультета, берёт образовательный кредит',
          speechTone: 'Эмоциональный', argumentation: 'Личный опыт',
          responseLength: 'Средний', typicalPhrases: 'Это ударит по нам, молодым',
          contexts: {
            create: [
              {
                src: 'стр. 4 · Раздел «Влияние на ставки»',
                quote:
                  '…изменение нормативов может транслироваться в стоимость розничных продуктов…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Максат', group: 'business',
          role: 'Предприниматель',
          gender: 'Мужской',
          age: '38 лет',
          dot: '#34d399',
          seatL: '43%',
          seatT: '26%',
          thinking:
            'Повышение требований к капиталу может увеличить стоимость кредитов для бизнеса. Особенно для малого и среднего.',
          style: 'Аналитический',
          criticality: 'Высокий',
          behaviorModel: 'Скептик',
          interests: ['МСБ', 'Стоимость кредитов', 'Рост бизнеса'],
          reasoning:
            'У меня производственный бизнес, и оборотные кредиты — это кровь компании. Когда банк держит больше капитала под каждый займ, он закладывает это в ставку. Для крупных корпораций разница незаметна, но для малого и среднего бизнеса даже 1–2% — это вопрос выживания. Нужны конкретные расчёты влияния на МСБ.',
          avatarIdx: 1,
          look: { skin: '#E4B892', hair: '#1E1A18', style: 'short', outfit: '#2F5D8C' },
          city: 'Алматы', education: 'Высшее',
          industry: 'МСБ', employerType: 'Частный бизнес', income: 'Высокий',
          openness: 'Нейтральный', decisionMaking: 'Аналитический',
          stance: 'Против', priority: 'Стоимость оборотных кредитов для МСБ',
          fears: 'Рост процентных ставок и снижение доступности кредитных линий',
          personalSituation: 'Владеет производственным предприятием на 45 сотрудников, регулярно использует кредитную линию',
          speechTone: 'Официальный', argumentation: 'Факты и цифры',
          responseLength: 'Развёрнутый', typicalPhrases: 'Покажите мне конкретные цифры',
          contexts: {
            create: [
              {
                src: 'стр. 6 · Раздел «Кредитование бизнеса»',
                quote: '…ужесточение требований повышает издержки фондирования…',
              },
              {
                src: 'стр. 9 · Приложение Б',
                quote: '…доля МСБ в кредитном портфеле составляет 34%…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Гульнар', group: 'population',
          role: 'Пенсионерка',
          gender: 'Женский',
          age: '67 лет',
          dot: '#f472b6',
          seatL: '65%',
          seatT: '27%',
          thinking:
            'Я переживаю, что это может привести к росту комиссий по счетам. Для пенсионеров это чувствительно.',
          style: 'Эмоциональный',
          criticality: 'Средний',
          behaviorModel: 'Защитник интересов',
          interests: ['Пенсии', 'Комиссии', 'Защита вкладчиков'],
          reasoning:
            'Мне важно, чтобы пенсию можно было снять без новых комиссий. Когда банкам становится дороже работать, они часто компенсируют это сборами за обслуживание карт и счетов. Хотелось бы, чтобы документ прямо защищал интересы пенсионеров и людей с небольшими доходами.',
          avatarIdx: 2,
          look: { skin: '#F1CFB4', hair: '#C9C4BE', style: 'bun', outfit: '#7A4E6B', glasses: true },
          city: 'Шымкент', education: 'Высшее',
          industry: 'Другое', employerType: 'Пенсионер', income: 'Низкий',
          openness: 'Консервативный', decisionMaking: 'Эмоциональный',
          stance: 'Нейтральный', priority: 'Сохранность пенсионных выплат и низкие комиссии',
          fears: 'Рост банковских комиссий за обслуживание счетов и карт',
          personalSituation: 'Получает пенсию, живёт на фиксированный доход, регулярно снимает наличные',
          speechTone: 'Разговорный', argumentation: 'Личный опыт',
          responseLength: 'Краткий', typicalPhrases: 'А что будет с нашими пенсиями?',
          contexts: {
            create: [
              {
                src: 'стр. 7 · Раздел «Розничные клиенты»',
                quote: '…банки вправе пересматривать тарифы на обслуживание…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Данияр', group: 'population',
          role: 'Заёмщик',
          gender: 'Мужской',
          age: '34 года',
          dot: '#60a5fa',
          seatL: '83%',
          seatT: '43%',
          thinking:
            'А как это повлияет на доступность кредитов для обычных людей? Мне важно, чтобы условия не стали хуже.',
          style: 'Прагматичный',
          criticality: 'Средний',
          behaviorModel: 'Наблюдатель',
          interests: ['Ипотека', 'Условия кредитов', 'Семейный бюджет'],
          reasoning:
            'Я плачу ипотеку и думаю о рефинансировании. Главный вопрос для меня — станет ли труднее одобрить кредит и вырастет ли ставка. Если требования к капиталу сделают банки осторожнее, часть заёмщиков просто не пройдёт по скорингу. Это нужно учитывать.',
          avatarIdx: 3,
          look: { skin: '#E9BE98', hair: '#1E1A18', style: 'short', outfit: '#3E6FB0' },
          city: 'Астана', education: 'Высшее',
          industry: 'Другое', employerType: 'Госслужащий', income: 'Средний',
          openness: 'Нейтральный', decisionMaking: 'Консервативный',
          stance: 'Нейтральный', priority: 'Условия ипотеки и доступность рефинансирования',
          fears: 'Ужесточение скоринга и рост ставок по ипотеке',
          personalSituation: 'Платит ипотеку, рассматривает рефинансирование, двое детей',
          speechTone: 'Разговорный', argumentation: 'Личный опыт',
          responseLength: 'Средний', typicalPhrases: 'Мне важно, чтобы условия не стали хуже',
          contexts: {
            create: [
              {
                src: 'стр. 5 · Раздел «Доступность»',
                quote: '…возможно ужесточение требований к заёмщикам…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Светлана', group: 'population',
          role: 'Вкладчик',
          gender: 'Женский',
          age: '45 лет',
          dot: '#fbbf24',
          seatL: '85%',
          seatT: '67%',
          thinking:
            'Более устойчивые банки — это надёжнее для моих накоплений. Но не снизятся ли ставки по депозитам?',
          style: 'Осторожный',
          criticality: 'Низкий',
          behaviorModel: 'Сторонник',
          interests: ['Депозиты', 'Надёжность банков', 'Накопления'],
          reasoning:
            'Для меня главное — сохранность вкладов. Более высокие требования к капиталу делают банки устойчивее, и это плюс. Но есть нюанс: если у банков растут издержки, они могут снижать ставки по депозитам. Хотелось бы баланса между надёжностью и доходностью.',
          avatarIdx: 4,
          look: { skin: '#F8DCC6', hair: '#E2B867', style: 'bob', outfit: '#B07F2A' },
          city: 'Алматы', education: 'Высшее',
          industry: 'Другое', employerType: 'Частный бизнес', income: 'Средний',
          openness: 'Консервативный', decisionMaking: 'Аналитический',
          stance: 'Поддерживает', priority: 'Надёжность банков и сохранность вкладов',
          fears: 'Снижение ставок по депозитам при росте издержек банков',
          personalSituation: 'Держит накопления в двух банках, планирует выход на пенсию через 15 лет',
          speechTone: 'Официальный', argumentation: 'Факты и цифры',
          responseLength: 'Средний', typicalPhrases: 'Надёжность важнее, чем лишний процент',
          contexts: {
            create: [
              {
                src: 'стр. 8 · Раздел «Устойчивость»',
                quote: '…повышение капитала снижает вероятность дефолта банка…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Ерлан', group: 'experts',
          role: 'Экономист',
          gender: 'Мужской',
          age: '52 года',
          dot: '#2dd4bf',
          seatL: '42%',
          seatT: '80%',
          thinking:
            'С экономической точки зрения, это повысит устойчивость банковской системы и снизит системные риски.',
          style: 'Аналитический',
          criticality: 'Высокий',
          behaviorModel: 'Эксперт',
          interests: ['Макроэкономика', 'Системные риски', 'Регулирование'],
          reasoning:
            'С макроэкономической позиции мера обоснована: больший буфер капитала повышает устойчивость системы к шокам и снижает вероятность кризисов. Краткосрочный минус — удорожание кредита, долгосрочный плюс — стабильность. Документу не хватает количественной оценки переходного периода.',
          avatarIdx: 5,
          look: { skin: '#EBC29E', hair: '#2B2420', style: 'short', outfit: '#2E7D68', glasses: true },
          city: 'Астана', education: 'Научная степень',
          industry: 'Финансы', employerType: 'Госслужащий', income: 'Высокий',
          openness: 'Прогрессивный', decisionMaking: 'Аналитический',
          stance: 'Поддерживает', priority: 'Макроэкономическая стабильность и снижение системных рисков',
          fears: 'Недостаточный переходный период, краткосрочный удар по кредитованию',
          personalSituation: 'Работает в аналитическом центре, публикует исследования по банковскому регулированию',
          speechTone: 'Академический', argumentation: 'Факты и цифры',
          responseLength: 'Развёрнутый', typicalPhrases: 'С точки зрения макроэкономики...',
          contexts: {
            create: [
              {
                src: 'стр. 2 · Резюме',
                quote: '…цель — повышение устойчивости банковского сектора…',
              },
              {
                src: 'стр.11 · Международный опыт',
                quote: '…аналогично требованиям Базель III…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Джессика', group: 'experts',
          role: 'Журналист',
          gender: 'Женский',
          age: '29 лет',
          dot: '#fb923c',
          seatL: '15%',
          seatT: '70%',
          thinking:
            'Как это объяснить читателям простым языком? И кто в итоге выигрывает, а кто платит?',
          style: 'Критический',
          criticality: 'Высокий',
          behaviorModel: 'Провокатор',
          interests: ['Прозрачность', 'Общественный интерес', 'Коммуникация'],
          reasoning:
            'Меня интересует, насколько прозрачно подаётся реформа. В документе много технических терминов, но мало объяснений для широкой аудитории. Кто несёт издержки — банки, бизнес или граждане? Без ясной коммуникации мера вызовет недоверие.',
          avatarIdx: 6,
          look: { skin: '#B9835C', hair: '#1C1412', style: 'bob', outfit: '#B4563A' },
          city: 'Алматы', education: 'Высшее',
          industry: 'Другое', employerType: 'Частный бизнес', income: 'Средний',
          openness: 'Прогрессивный', decisionMaking: 'Интуитивный',
          stance: 'Неопределившийся', priority: 'Прозрачность и понятность реформы для общества',
          fears: 'Непрозрачная коммуникация и манипуляция общественным мнением',
          personalSituation: 'Ведёт экономическую колонку, 50 тысяч подписчиков в соцсетях',
          speechTone: 'Разговорный', argumentation: 'Ссылки на авторитеты',
          responseLength: 'Краткий', typicalPhrases: 'Объясните это простым языком',
          contexts: {
            create: [
              {
                src: 'стр. 1 · Введение',
                quote: '…документ носит технический характер…',
              },
            ],
          },
        },
      }),

      prisma.persona.create({
        data: {
          name: 'Тимур', group: 'population',
          role: 'IT-специалист',
          gender: 'Мужской',
          age: '31 год',
          dot: '#818cf8',
          seatL: '25%',
          seatT: '31%',
          thinking:
            'Интересно, потребует ли это новых отчётных систем и как быстро банки смогут перестроить процессы.',
          style: 'Прагматичный',
          criticality: 'Средний',
          behaviorModel: 'Наблюдатель',
          interests: ['Финтех', 'Автоматизация', 'Внедрение'],
          reasoning:
            'С технической стороны новые нормативы означают доработку систем расчёта капитала и отчётности. Это затраты на внедрение и сроки. Хорошо бы предусмотреть переходный период и API для регуляторной отчётности, иначе мелкие банки не успеют адаптироваться.',
          avatarIdx: 7,
          look: { skin: '#E6BC97', hair: '#231C19', style: 'spiky', outfit: '#3A3F4D' },
          city: 'Алматы', education: 'Высшее',
          industry: 'IT', employerType: 'Частный бизнес', income: 'Высокий',
          openness: 'Прогрессивный', decisionMaking: 'Аналитический',
          stance: 'Нейтральный', priority: 'Технические аспекты внедрения и API для отчётности',
          fears: 'Нереалистичные сроки адаптации IT-систем в банках',
          personalSituation: 'Работает в финтех-компании, занимается интеграцией с банковскими API',
          speechTone: 'Официальный', argumentation: 'Факты и цифры',
          responseLength: 'Средний', typicalPhrases: 'Какой API предусмотрен для отчётности?',
          contexts: {
            create: [
              {
                src: 'стр.10 · Раздел «Отчётность»',
                quote: '…потребуется адаптация информационных систем…',
              },
            ],
          },
        },
      }),
    ]);

  // ─── Demo Project ────────────────────────────────────────────
  console.log('[seed] Seeding demo project...');

  const project = await prisma.project.create({
    data: {
      title: 'Повышение требований к капиталу банков',
      subtitle: 'Аналитическая записка НБРК',
      mode: 'Round Table',
      iterations: 5,
      currentIteration: 3,
      moderator: true,
      goal: 'risk_search',
      status: 'running',
      llmModel: LLM_MODEL,
    },
  });

  // ─── Attach all personas to the project ─────────────────────
  const allPersonas = [aliya, maksat, gulnar, daniyar, svetlana, erlan, aibek, timur];

  await prisma.projectPersona.createMany({
    data: allPersonas.map((p) => ({ projectId: project.id, personaId: p.id })),
  });

  // ─── Timeline (5 messages from mock discussion.js) ───────────
  console.log('[seed] Seeding timeline...');

  await prisma.timelineMessage.createMany({
    data: [
      {
        projectId: project.id,
        personaId: maksat.id,
        n: 1,
        iteration: 1,
        time: '10:15:23',
        text: 'Повышение требований к капиталу может увеличить стоимость кредитов для бизнеса. Особенно для малого и среднего. Нужно понять, как это отразится на нас.',
      },
      {
        projectId: project.id,
        personaId: gulnar.id,
        n: 2,
        iteration: 1,
        time: '10:15:47',
        text: 'Я переживаю, что это может привести к росту комиссий по счетам. Для пенсионеров это чувствительно.',
      },
      {
        projectId: project.id,
        personaId: erlan.id,
        n: 3,
        iteration: 1,
        time: '10:16:02',
        text: 'С экономической точки зрения, это повысит устойчивость банковской системы и снизит системные риски.',
      },
      {
        projectId: project.id,
        personaId: daniyar.id,
        n: 4,
        iteration: 1,
        time: '10:16:18',
        text: 'А как это повлияет на доступность кредитов для обычных людей? Мне важно, чтобы условия не стали хуже.',
      },
      {
        projectId: project.id,
        personaId: svetlana.id,
        n: 5,
        iteration: 1,
        time: '10:16:40',
        text: 'Более устойчивые банки — это плюс для моих накоплений. Но важно, чтобы не пострадали ставки по депозитам.',
      },
    ],
  });

  // ─── Discussion Summary ───────────────────────────────────────
  console.log('[seed] Seeding discussion summary...');

  await prisma.discussionSummary.create({
    data: {
      projectId: project.id,
      mood: 'Нейтрально-осторожное',
      moodEmoji: '😐',
      conclusion:
        'Большинство участников признают необходимость меры, но требуют конкретных механизмов защиты для МСБ и розничных клиентов.',
      topics: ['Кредиты для бизнеса', 'Комиссии', 'Доступность кредитов', 'Устойчивость банков'],
      risks: ['Рост стоимости кредитов', 'Комиссии для клиентов', 'Доступность кредитов'],
      improves: [
        'Уточнить влияние на комиссии',
        'Добавить примеры для МСБ',
        'Показать выгоды для клиентов',
      ],
    },
  });

  // ─── Analytics Report ─────────────────────────────────────────
  console.log('[seed] Seeding analytics report...');

  await prisma.analyticsReport.create({
    data: {
      projectId: project.id,
      conclusions: [
        {
          n: 1,
          text: 'Большинство участников считают цель документа — повышение устойчивости банков — оправданной.',
        },
        {
          n: 2,
          text: 'Главный спорный момент: распределение издержек между банками, бизнесом и гражданами.',
        },
        {
          n: 3,
          text: 'Консенсус: мера нужна, но требует смягчающих механизмов и переходного периода.',
        },
      ],
      topicBars: [
        { name: 'Кредиты для бизнеса', pct: 92 },
        { name: 'Комиссии для клиентов', pct: 74 },
        { name: 'Доступность кредитов', pct: 68 },
        { name: 'Устойчивость банков', pct: 55 },
      ],
      risks: ['Рост стоимости кредитов', 'Комиссии для клиентов', 'Доступность кредитов'],
      positives: [
        { text: 'Повышение устойчивости банков', by: 'Ерлан, Светлана' },
        { text: 'Снижение системных рисков', by: 'Ерлан' },
        { text: 'Защита вкладов', by: 'Светлана' },
      ],
      recommendations: [
        'Добавить количественную оценку влияния на ставки по кредитам МСБ.',
        'Прямо прописать защиту тарифов для социально уязвимых групп.',
        'Предусмотреть переходный период и требования к ИТ-отчётности.',
        'Сопроводить документ разъяснением для широкой аудитории.',
      ],
      altParagraphs: [
        {
          tag: 'без изм.',
          text: 'Настоящий документ устанавливает повышенные требования к достаточности капитала банков второго уровня.',
          color: '#6f6a85',
        },
        {
          tag: 'изменено',
          text: 'Внедрение требований осуществляется поэтапно в течение переходного периода 18 месяцев, что снижает риск резкого удорожания кредитов для малого и среднего бизнеса.',
          color: '#fbbf24',
        },
        {
          tag: 'добавлено',
          text: 'Для социально уязвимых категорий клиентов сохраняются действующие тарифы на базовое банковское обслуживание.',
          color: '#34d399',
        },
        {
          tag: 'изменено',
          text: 'Ожидаемый эффект — повышение устойчивости сектора при контролируемом влиянии на доступность розничного кредитования.',
          color: '#fbbf24',
        },
      ],
    },
  });

  // ─── Персоны 8–31 ─────────────────────────────────────────────
  await seedNewPersonas();

  console.log('[seed] Done! Created:');
  console.log('  • 34 personas');
  console.log('  • 1 demo project');
  console.log('  • 5 timeline messages');
  console.log('  • 1 discussion summary');
  console.log('  • 1 analytics report');
}

// ─── 26 новых персон (avatarIdx 8–33) ────────────────────────
//
// Returns how many were actually created. Personas already in the library are
// skipped by name, so calling this on a populated database is a no-op rather
// than a second insert — see the note in main().
async function seedNewPersonas(): Promise<number> {
  const taken = new Set(
    (await prisma.persona.findMany({ select: { name: true } })).map((p) => p.name),
  );

  const create = (data: Parameters<typeof prisma.persona.create>[0]['data']) =>
    taken.has(data.name) ? Promise.resolve(null) : prisma.persona.create({ data });

  const results = await Promise.all([
    // ── Image 1: Официальные / Форменные ──────────────────────

    create({
      name: 'Назгуль', group: 'population', role: 'Полицейский', gender: 'Женский', age: '32 года',
      dot: '#a78bff', seatL: '20%', seatT: '40%', avatarIdx: 8,
      look: { skin: '#EAC3A0', hair: '#221A17', style: 'bun', outfit: '#2C3E5C' },
      thinking: 'Любые изменения в финансовой системе влияют на безопасность граждан. Нужно думать о порядке.',
      style: 'Прагматичный', criticality: 'Высокий', behaviorModel: 'Скептик',
      interests: ['Законность', 'Общественный порядок', 'Финансовая безопасность'],
      reasoning: 'Моя работа — следить за соблюдением законов. Банки тоже обязаны соблюдать правила. Если повышение требований к капиталу сделает систему честнее и снизит мошенничество, я за. Но хочу понять: как это повлияет на обычных граждан, особенно тех, кто живёт в долг?',
      city: 'Астана', education: 'Высшее', industry: 'Госслужба', employerType: 'Госслужащий', income: 'Средний',
      openness: 'Консервативный', decisionMaking: 'Аналитический',
      stance: 'Нейтральный', priority: 'Законность и прозрачность банковского сектора',
      fears: 'Рост финансового мошенничества при слабом регулировании',
      personalSituation: 'Служит в полиции 9 лет, выплачивает ипотеку, воспитывает дочь',
      speechTone: 'Официальный', argumentation: 'Факты и цифры',
      responseLength: 'Средний', typicalPhrases: 'Закон должен работать для всех',
    }),

    create({
      name: 'Асхат', group: 'population', role: 'Офицер армии', gender: 'Мужской', age: '44 года',
      dot: '#34d399', seatL: '30%', seatT: '55%', avatarIdx: 9,
      look: { skin: '#E2B791', hair: '#26201C', style: 'short', outfit: '#4A5D3A' },
      thinking: 'Государство должно держать финансовую систему под контролем. Слабые банки — угроза национальной безопасности.',
      style: 'Критический', criticality: 'Средний', behaviorModel: 'Наблюдатель',
      interests: ['Национальная безопасность', 'Государственные интересы', 'Стабильность'],
      reasoning: 'Банки — часть критической инфраструктуры страны. Если их капитал недостаточен, в кризис они падают, а государство несёт потери. Поддерживаю ужесточение требований. Но меня беспокоит, что иностранные банки могут воспользоваться этим для давления на казахстанский рынок.',
      city: 'Астана', education: 'Высшее', industry: 'Госслужба', employerType: 'Госслужащий', income: 'Средний',
      openness: 'Консервативный', decisionMaking: 'Консервативный',
      stance: 'Поддерживает', priority: 'Национальная финансовая безопасность и суверенитет',
      fears: 'Иностранное влияние на банковский сектор при ослаблении отечественных банков',
      personalSituation: 'Военный стаж 20 лет, живёт на государственное жильё, накопления в ЕНПФ',
      speechTone: 'Официальный', argumentation: 'Ссылки на авторитеты',
      responseLength: 'Краткий', typicalPhrases: 'Интересы государства — прежде всего',
    }),

    create({
      name: 'Зауреш', group: 'experts', role: 'Директор банка', gender: 'Женский', age: '51 год',
      dot: '#f472b6', seatL: '50%', seatT: '35%', avatarIdx: 10,
      look: { skin: '#F1CFB4', hair: '#3A2A22', style: 'bun', outfit: '#1F3A5F', glasses: true },
      thinking: 'Требования разумны, но переходный период слишком короткий. Мы не успеем перестроить портфель без потерь.',
      style: 'Аналитический', criticality: 'Высокий', behaviorModel: 'Эксперт',
      interests: ['Банковский сектор', 'Рентабельность', 'Регулирование'],
      reasoning: 'Я управляю банком 12 лет. Понимаю цель регулятора — повысить устойчивость. Но реализация вызывает вопросы. Переходный период в 12 месяцев критически мал: нам нужно реструктурировать активы, пересмотреть кредитный портфель и докапитализироваться. Это минимум 2 года работы. Прошу продлить переходный период.',
      city: 'Алматы', education: 'MBA', industry: 'Финансы', employerType: 'Частный бизнес', income: 'Высокий',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Против', priority: 'Реалистичный переходный период для адаптации банков',
      fears: 'Вынужденное сокращение кредитного портфеля за счёт малого бизнеса',
      personalSituation: 'Директор среднего регионального банка, отвечает за 400 сотрудников',
      speechTone: 'Академический', argumentation: 'Факты и цифры',
      responseLength: 'Развёрнутый', typicalPhrases: '12 месяцев — нереалистичный срок',
    }),

    create({
      name: 'Бауыржан', group: 'population', role: 'Пожарный МЧС', gender: 'Мужской', age: '36 лет',
      dot: '#60a5fa', seatL: '70%', seatT: '60%', avatarIdx: 11,
      look: { skin: '#E6BC97', hair: '#201A16', style: 'short', outfit: '#B03A2E' },
      thinking: 'Я не эксперт в финансах, но хочу знать — цены на жильё не вырастут ещё больше?',
      style: 'Прагматичный', criticality: 'Низкий', behaviorModel: 'Наблюдатель',
      interests: ['Жильё', 'Зарплата', 'Доступность услуг'],
      reasoning: 'Мы с женой копим на первоначальный взнос. Если банки ужесточат требования к заёмщикам — нас могут не одобрить. Я работаю в госструктуре, зарплата стабильная, но небольшая. Хочу понять: людям с бюджетными зарплатами вообще останется возможность взять ипотеку?',
      city: 'Шымкент', education: 'Среднее', industry: 'Госслужба', employerType: 'Госслужащий', income: 'Низкий',
      openness: 'Нейтральный', decisionMaking: 'Интуитивный',
      stance: 'Нейтральный', priority: 'Сохранение доступа к ипотеке для бюджетников',
      fears: 'Ужесточение скоринга отрежет бюджетных работников от ипотеки',
      personalSituation: 'Снимает квартиру, копит на первоначальный взнос, двое детей',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'А простым людям это как?',
    }),

    create({
      name: 'Жанар', group: 'population', role: 'Инженер-строитель', gender: 'Женский', age: '28 лет',
      dot: '#fbbf24', seatL: '15%', seatT: '60%', avatarIdx: 12,
      look: { skin: '#F2CBAB', hair: '#2B1F1A', style: 'long', outfit: '#C98A2D' },
      thinking: 'Проектное финансирование и так дорогое. Новые нормативы могут заморозить стройки.',
      style: 'Аналитический', criticality: 'Средний', behaviorModel: 'Скептик',
      interests: ['Строительство', 'Проектное финансирование', 'Инфраструктура'],
      reasoning: 'В строительстве без проектного финансирования ничего не строится. Банки и так требуют 30% собственного капитала от застройщика. Если ужесточить требования к самому банку, он станет осторожнее выдавать проектные кредиты. Это заморозит жилищные проекты, дефицит жилья вырастет, цены — тоже.',
      city: 'Алматы', education: 'Высшее', industry: 'МСБ', employerType: 'Частный бизнес', income: 'Средний',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Против', priority: 'Сохранение доступности проектного финансирования в строительстве',
      fears: 'Заморозка жилищных проектов из-за удорожания проектного финансирования',
      personalSituation: 'Работает в строительной компании, ведёт 3 жилых проекта',
      speechTone: 'Официальный', argumentation: 'Факты и цифры',
      responseLength: 'Средний', typicalPhrases: 'Без проектного финансирования стройки встанут',
    }),

    create({
      name: 'Сейткали', group: 'business', role: 'Прораб', gender: 'Мужской', age: '55 лет',
      dot: '#2dd4bf', seatL: '80%', seatT: '30%', avatarIdx: 13,
      look: { skin: '#E2B791', hair: '#9B948C', style: 'short', outfit: '#8A6D3B' },
      thinking: 'Мне нужны деньги на технику. Банк уже отказал раз. Если ужесточат — совсем не дадут.',
      style: 'Прагматичный', criticality: 'Средний', behaviorModel: 'Защитник интересов',
      interests: ['МСБ', 'Кредиты на оборудование', 'Строительство'],
      reasoning: 'У меня бригада из 8 человек. Хочу взять экскаватор в лизинг — банк заставляет оформить кредит. Процент и так 22%, с залогом. Если банки ужесточат скоринг из-за новых нормативов, мелким подрядчикам вообще закроют доступ к финансированию. Мы уйдём в серые схемы.',
      city: 'Алматы', education: 'Среднее', industry: 'МСБ', employerType: 'Самозанятый', income: 'Средний',
      openness: 'Консервативный', decisionMaking: 'Интуитивный',
      stance: 'Против', priority: 'Сохранение доступа к кредитам для мелких подрядчиков',
      fears: 'Полное закрытие кредитования для микробизнеса без залога',
      personalSituation: 'ИП, строительная бригада, ищет кредит на оборудование',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'Нам кредиты без залога уже не дают',
    }),

    create({
      name: 'Куляш', group: 'experts', role: 'Госчиновник', gender: 'Женский', age: '48 лет',
      dot: '#fb923c', seatL: '60%', seatT: '70%', avatarIdx: 14,
      look: { skin: '#F1CFB4', hair: '#2E2420', style: 'bun', outfit: '#1F6347' },
      thinking: 'Документ соответствует международным стандартам и приоритетам финансовой стабильности.',
      style: 'Осторожный', criticality: 'Низкий', behaviorModel: 'Сторонник',
      interests: ['Госполитика', 'Международные стандарты', 'Регуляторная среда'],
      reasoning: 'Мы работаем над приведением казахстанских стандартов в соответствие с Базель III. Это необходимый шаг для доверия международных инвесторов. Да, в краткосрочной перспективе возможны издержки, но долгосрочная выгода — стабильность всей финансовой системы и снижение суверенных рисков.',
      city: 'Астана', education: 'MBA', industry: 'Госслужба', employerType: 'Госслужащий', income: 'Высокий',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Поддерживает', priority: 'Международная репутация и соответствие стандартам Базель III',
      fears: 'Дискредитация реформы из-за некачественной коммуникации',
      personalSituation: 'Работает в Министерстве финансов, координирует с НБРК',
      speechTone: 'Академический', argumentation: 'Ссылки на авторитеты',
      responseLength: 'Развёрнутый', typicalPhrases: 'В соответствии с Базель III...',
    }),

    create({
      name: 'Нурлан', group: 'population', role: 'Рабочий завода', gender: 'Мужской', age: '40 лет',
      dot: '#818cf8', seatL: '85%', seatT: '50%', avatarIdx: 15,
      look: { skin: '#E4B892', hair: '#262019', style: 'short', outfit: '#5A6472' },
      thinking: 'Богатые банкиры решают что-то между собой. А мы снова будем платить за их решения.',
      style: 'Эмоциональный', criticality: 'Низкий', behaviorModel: 'Наблюдатель',
      interests: ['Зарплата', 'Цены', 'Социальная справедливость'],
      reasoning: 'Я работаю на заводе уже 15 лет. Все эти реформы — они никогда не делают жизнь проще для таких как я. Процент по кредиту на холодильник был 27%. Банки и так жируют. Теперь говорят, что нужно ещё больше капитала. Значит, нам опять поднимут ставки. Кто за нас говорит?',
      city: 'Темиртау', education: 'Среднее', industry: 'Другое', employerType: 'Частный бизнес', income: 'Низкий',
      openness: 'Консервативный', decisionMaking: 'Эмоциональный',
      stance: 'Против', priority: 'Снижение стоимости потребительских кредитов для рабочих',
      fears: 'Ещё один рост ставок по потребительским кредитам',
      personalSituation: 'Работает на металлургическом комбинате, снимает квартиру, трое детей',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'Кто за нас говорит?',
    }),

    // ── Image 2: Молодые профессионалы ───────────────────────────

    create({
      name: 'Аружан', group: 'population', role: 'Маркетолог', gender: 'Женский', age: '25 лет',
      dot: '#a78bff', seatL: '10%', seatT: '30%', avatarIdx: 16,
      look: { skin: '#F6D2B8', hair: '#3B2A20', style: 'long', outfit: '#C2527E' },
      thinking: 'Банки красиво рассказывают о выгодах, но реальные условия всегда мелким шрифтом.',
      style: 'Эмоциональный', criticality: 'Средний', behaviorModel: 'Провокатор',
      interests: ['Права потребителей', 'Цифровые финансы', 'Прозрачность'],
      reasoning: 'Я работаю в маркетинге и знаю, как информация подаётся. Этот документ написан так, что обычный человек ничего не поймёт. Банки будут использовать новые нормативы как повод поднять комиссии и срезать условия по картам. Нужна обязательная публичная коммуникация на простом языке.',
      city: 'Алматы', education: 'Высшее', industry: 'МСБ', employerType: 'Частный бизнес', income: 'Средний',
      openness: 'Прогрессивный', decisionMaking: 'Интуитивный',
      stance: 'Нейтральный', priority: 'Прозрачность условий для потребителей при изменении регулирования',
      fears: 'Скрытый рост комиссий и ухудшение условий по картам под прикрытием реформы',
      personalSituation: 'Работает в digital-агентстве, активный пользователь 3 банковских приложений',
      speechTone: 'Разговорный', argumentation: 'Эмоции',
      responseLength: 'Средний', typicalPhrases: 'Это снова мелким шрифтом!',
    }),

    create({
      name: 'Дамир', group: 'population', role: 'Разработчик ПО', gender: 'Мужской', age: '27 лет',
      dot: '#34d399', seatL: '25%', seatT: '45%', avatarIdx: 17,
      look: { skin: '#EBC29E', hair: '#1E1A18', style: 'spiky', outfit: '#4B5A6B', glasses: true },
      thinking: 'Новые нормативы означают новые системы отчётности. Кто даст банкам время на интеграцию?',
      style: 'Аналитический', criticality: 'Средний', behaviorModel: 'Эксперт',
      interests: ['Финтех', 'API', 'Open Banking', 'Регтех'],
      reasoning: 'Я занимаюсь интеграцией банковских API в финтех-продукты. Каждое изменение в регуляторике — это итерация в инфраструктуре. Новые требования к капиталу означают новые форматы отчётности, возможно новые поля в АБС. Банки должны получить стандарт API для регуляторной отчётности заранее, а не угадывать.',
      city: 'Алматы', education: 'Высшее', industry: 'IT', employerType: 'Частный бизнес', income: 'Высокий',
      openness: 'Прогрессивный', decisionMaking: 'Аналитический',
      stance: 'Нейтральный', priority: 'Стандарт API и технические спецификации для внедрения',
      fears: 'Отсутствие технических стандартов и несовместимость систем',
      personalSituation: 'Разрабатывает платёжные решения для стартапа, активно использует банковские API',
      speechTone: 'Официальный', argumentation: 'Факты и цифры',
      responseLength: 'Средний', typicalPhrases: 'Дайте нам технический стандарт',
    }),

    create({
      name: 'Меруерт', group: 'experts', role: 'Адвокат', gender: 'Женский', age: '34 года',
      dot: '#f472b6', seatL: '40%', seatT: '65%', avatarIdx: 18,
      look: { skin: '#F1CFB4', hair: '#241B16', style: 'bob', outfit: '#5B4A68' },
      thinking: 'Документ не содержит механизмов защиты прав потребителей при ухудшении условий.',
      style: 'Критический', criticality: 'Высокий', behaviorModel: 'Скептик',
      interests: ['Банковское право', 'Защита потребителей', 'Compliance'],
      reasoning: 'С юридической точки зрения, документ создаёт новые обязательства для банков, но не устанавливает ответственности за перекладывание издержек на клиентов. Нет нормы, запрещающей одностороннее изменение условий договора в связи с введением новых нормативов. Это правовой пробел, который будет использован.',
      city: 'Алматы', education: 'Высшее', industry: 'Финансы', employerType: 'Самозанятый', income: 'Высокий',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Против', priority: 'Правовая защита потребителей от одностороннего изменения условий',
      fears: 'Правовой пробел позволит банкам ухудшать условия, ссылаясь на новые нормативы',
      personalSituation: 'Специализируется на банковских спорах, представляет интересы клиентов банков',
      speechTone: 'Академический', argumentation: 'Ссылки на авторитеты',
      responseLength: 'Развёрнутый', typicalPhrases: 'Это правовой пробел',
    }),

    create({
      name: 'Руслан', group: 'experts', role: 'Топ-менеджер банка', gender: 'Мужской', age: '48 лет',
      dot: '#60a5fa', seatL: '55%', seatT: '40%', avatarIdx: 19,
      look: { skin: '#E9BE98', hair: '#3A332C', style: 'short', outfit: '#24466B' },
      thinking: 'ROE упадёт на 3–5 пп. Акционеры будут недовольны. Нам нужен план смягчения.',
      style: 'Аналитический', criticality: 'Высокий', behaviorModel: 'Защитник интересов',
      interests: ['Рентабельность капитала', 'Конкурентоспособность', 'Акционерная стоимость'],
      reasoning: 'Повышение требований к капиталу снижает рентабельность — это математика. ROE упадёт, это ударит по дивидендам и инвестиционной привлекательности банков. В ответ банки будут либо поднимать ставки по кредитам, либо урезать низкомаржинальные продукты. Прошу дать банкам право постепенно реструктурировать портфели.',
      city: 'Алматы', education: 'MBA', industry: 'Финансы', employerType: 'Частный бизнес', income: 'Высокий',
      openness: 'Консервативный', decisionMaking: 'Аналитический',
      stance: 'Против', priority: 'Сохранение рентабельности и инвестиционной привлекательности банков',
      fears: 'Отток иностранного капитала из казахстанских банков при снижении ROE',
      personalSituation: 'Управляет корпоративным блоком крупного банка, отчитывается перед международными акционерами',
      speechTone: 'Официальный', argumentation: 'Факты и цифры',
      responseLength: 'Развёрнутый', typicalPhrases: 'ROE упадёт — это математика',
    }),

    create({
      name: 'Камила', group: 'business', role: 'Дизайнер интерьера', gender: 'Женский', age: '26 лет',
      dot: '#fbbf24', seatL: '75%', seatT: '45%', avatarIdx: 20,
      look: { skin: '#F6D2B8', hair: '#4A2C1D', style: 'bob', outfit: '#D1784C' },
      thinking: 'Как ИП я уже не могу получить нормальный кредит. После реформы станет ещё хуже?',
      style: 'Эмоциональный', criticality: 'Средний', behaviorModel: 'Наблюдатель',
      interests: ['Самозанятость', 'Кредиты для ИП', 'Творческий бизнес'],
      reasoning: 'Я работаю как ИП год и уже столкнулась с тем, что банки неохотно кредитуют самозанятых. У меня нет «стабильного работодателя», нет справки о доходах 2-НДФЛ. При ужесточении требований к капиталу банки первыми сократят именно рискованные сегменты — а ИП и фрилансеры считаются высоким риском.',
      city: 'Алматы', education: 'Высшее', industry: 'Другое', employerType: 'Самозанятый', income: 'Средний',
      openness: 'Прогрессивный', decisionMaking: 'Интуитивный',
      stance: 'Против', priority: 'Сохранение доступа к кредитованию для самозанятых и ИП',
      fears: 'Самозанятые первыми попадут под ужесточение скоринга',
      personalSituation: 'Фрилансер-дизайнер, ИП первый год, ищет кредит на закупку материалов',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Средний', typicalPhrases: 'Я ИП — мне уже сложнее',
    }),

    create({
      name: 'Санжар', group: 'experts', role: 'PhD-студент экономики', gender: 'Мужской', age: '24 года',
      dot: '#2dd4bf', seatL: '90%', seatT: '40%', avatarIdx: 21,
      look: { skin: '#E6BC97', hair: '#231C19', style: 'short', outfit: '#6B5CA8', glasses: true },
      thinking: 'Интересно сравнить казахстанскую модель с опытом Польши и Южной Кореи при внедрении Базель III.',
      style: 'Аналитический', criticality: 'Высокий', behaviorModel: 'Эксперт',
      interests: ['Банковское регулирование', 'Сравнительная экономика', 'Базель III'],
      reasoning: 'Изучаю влияние пруденциального регулирования на кредитную активность в развивающихся экономиках. Страны, внедрявшие Базель III быстро, показывали 2–4% сокращение кредитования в первые 2 года. Казахстану с учётом структуры экономики нужен именно постепенный переход. Данные это подтверждают.',
      city: 'Алматы', education: 'Научная степень', industry: 'Образование', employerType: 'Студент', income: 'Низкий',
      openness: 'Прогрессивный', decisionMaking: 'Аналитический',
      stance: 'Нейтральный', priority: 'Эмпирическое обоснование и постепенный переход по модели лучших практик',
      fears: 'Игнорирование международных данных при установке переходного периода',
      personalSituation: 'Пишет диссертацию по пруденциальному регулированию, стипендиат',
      speechTone: 'Академический', argumentation: 'Факты и цифры',
      responseLength: 'Развёрнутый', typicalPhrases: 'Данные говорят о 2–4% сокращении кредитования',
    }),

    create({
      name: 'Нургуль', group: 'business', role: 'Владелец кафе', gender: 'Женский', age: '39 лет',
      dot: '#fb923c', seatL: '5%', seatT: '70%', avatarIdx: 22,
      look: { skin: '#EFC5A2', hair: '#2A1C17', style: 'bun', outfit: '#A8553F' },
      thinking: 'У меня кафе на 12 столиков. Кредит на оборудование взяла под 19%. Ещё выше — закроюсь.',
      style: 'Прагматичный', criticality: 'Средний', behaviorModel: 'Защитник интересов',
      interests: ['МСБ', 'Общепит', 'Кредиты для малого бизнеса'],
      reasoning: 'Мой бизнес живёт на тонкой марже. Оборудование, аренда, продукты — всё дорого. Взяла кредит под 19%, каждый месяц отдаю треть выручки. Если банки поднимут ставки ещё на 2–3% из-за новых нормативов, многие в общепите просто закроются. Нас никто не слышит, когда принимают такие решения.',
      city: 'Алматы', education: 'Среднее', industry: 'МСБ', employerType: 'Частный бизнес', income: 'Средний',
      openness: 'Нейтральный', decisionMaking: 'Интуитивный',
      stance: 'Против', priority: 'Сохранение доступных кредитов для микробизнеса в сфере услуг',
      fears: 'Рост ставок приведёт к волне закрытий малых предприятий',
      personalSituation: 'Кафе на 12 столиков, 4 сотрудника, кредит на кухонное оборудование',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'Ещё выше — закроюсь',
    }),

    create({
      name: 'Қайрат', group: 'business', role: 'Риелтор', gender: 'Мужской', age: '50 лет',
      dot: '#818cf8', seatL: '20%', seatT: '75%', avatarIdx: 23,
      look: { skin: '#E4B892', hair: '#6E665E', style: 'short', outfit: '#3C5A75' },
      thinking: 'Рынок недвижимости завязан на ипотеку. Если ипотека подорожает — продажи встанут.',
      style: 'Прагматичный', criticality: 'Средний', behaviorModel: 'Скептик',
      interests: ['Рынок недвижимости', 'Ипотека', 'Строительство'],
      reasoning: '20 лет в недвижимости. Рынок живёт на ипотечных покупателях — 70% сделок идут с привлечением банка. Если ужесточатся требования к заёмщикам или вырастет ставка, число одобрений упадёт. Я видел 2008 год. Регулятор должен понимать: банковские нормативы — это не абстракция, это конкретные квартиры, которые люди не смогут купить.',
      city: 'Астана', education: 'Высшее', industry: 'МСБ', employerType: 'Самозанятый', income: 'Средний',
      openness: 'Консервативный', decisionMaking: 'Консервативный',
      stance: 'Против', priority: 'Сохранение объёма ипотечного кредитования и доступности жилья',
      fears: 'Падение рынка недвижимости из-за сокращения ипотечных одобрений',
      personalSituation: 'Агентство недвижимости 12 лет, 80% сделок — ипотечные покупатели',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Средний', typicalPhrases: 'Я видел 2008 год',
    }),

    // ── Image 3: Смешанная аудитория ─────────────────────────────

    create({
      name: 'Алинур', group: 'experts', role: 'Блогер-инфлюенсер', gender: 'Женский', age: '22 года',
      dot: '#a78bff', seatL: '35%', seatT: '25%', avatarIdx: 24,
      look: { skin: '#F8DCC6', hair: '#5A3A28', style: 'long', outfit: '#D16BA5' },
      thinking: 'Сниму видео про это — пусть подписчики знают, что банки снова придумали что-то против нас.',
      style: 'Эмоциональный', criticality: 'Низкий', behaviorModel: 'Провокатор',
      interests: ['Поколение Z', 'Цифровые банки', 'Контент', 'Права молодёжи'],
      reasoning: 'У меня 180К подписчиков и я вижу, как банки работают с молодёжью. Они красиво рекламируют кэшбэки, а потом тихо меняют условия. Теперь говорят, что надо больше капитала — значит, нам снизят кэшбэки и поднимут комиссии. Сниму видео с разбором, пусть люди знают правду.',
      city: 'Алматы', education: 'Высшее (в процессе)', industry: 'Другое', employerType: 'Самозанятый', income: 'Средний',
      openness: 'Прогрессивный', decisionMaking: 'Интуитивный',
      stance: 'Против', priority: 'Защита условий для цифровых банков и молодёжных продуктов',
      fears: 'Банки уберут кэшбэки и цифровые преимущества под предлогом новых нормативов',
      personalSituation: 'Блогер о финансовой грамотности, 180К подписчиков, живёт на доход от рекламы',
      speechTone: 'Разговорный', argumentation: 'Эмоции',
      responseLength: 'Краткий', typicalPhrases: 'Снимаю видео — пусть все знают!',
    }),

    create({
      name: 'Арман', group: 'experts', role: 'Преподаватель экономики', gender: 'Мужской', age: '36 лет',
      dot: '#34d399', seatL: '50%', seatT: '55%', avatarIdx: 25,
      look: { skin: '#E9BE98', hair: '#241E1A', style: 'short', outfit: '#4E3F6E', glasses: true },
      thinking: 'Студентам нужно объяснять, что за каждым нормативом стоит выбор: кто несёт риск — банк или общество.',
      style: 'Аналитический', criticality: 'Высокий', behaviorModel: 'Эксперт',
      interests: ['Образование', 'Банковская теория', 'Моральный риск'],
      reasoning: 'На лекциях я использую такие документы как учебный кейс. Ключевой вопрос здесь — моральный риск: если банки знают, что государство спасёт их при кризисе, они недостаточно мотивированы держать капитал добровольно. Поэтому регулирование необходимо. Но конкретные цифры нормативов нужно обосновывать эмпирически.',
      city: 'Алматы', education: 'Научная степень', industry: 'Образование', employerType: 'Госслужащий', income: 'Средний',
      openness: 'Прогрессивный', decisionMaking: 'Аналитический',
      stance: 'Поддерживает', priority: 'Эмпирическое обоснование нормативов и академическая прозрачность',
      fears: 'Нормативы выбраны без достаточного академического обоснования',
      personalSituation: 'Доцент кафедры финансов, преподаёт банковское дело, ведёт прикладные исследования',
      speechTone: 'Академический', argumentation: 'Факты и цифры',
      responseLength: 'Развёрнутый', typicalPhrases: 'Это классический вопрос морального риска',
    }),

    create({
      name: 'Жулдыз', group: 'population', role: 'Врач', gender: 'Женский', age: '31 год',
      dot: '#f472b6', seatL: '65%', seatT: '50%', avatarIdx: 26,
      look: { skin: '#F2CBAB', hair: '#2A1F1A', style: 'bob', outfit: '#2E8C7F' },
      thinking: 'Медицинский кредит брала под 21%. Если ставки вырастут — буду дольше отдавать долг.',
      style: 'Осторожный', criticality: 'Средний', behaviorModel: 'Наблюдатель',
      interests: ['Здравоохранение', 'Кредиты для специалистов', 'Зарплата бюджетников'],
      reasoning: 'Я работаю в государственной больнице. Зарплата стабильная, но небольшая для Алматы. Взяла кредит на повышение квалификации и переезд. Когда читаю про новые требования к банкам, думаю: а кто защитит специалистов с госзарплатой? Нам и так трудно получить кредит, если ужесточат условия — совсем откажут.',
      city: 'Алматы', education: 'Высшее', industry: 'Здравоохранение', employerType: 'Госслужащий', income: 'Средний',
      openness: 'Нейтральный', decisionMaking: 'Консервативный',
      stance: 'Нейтральный', priority: 'Доступность кредитов для специалистов бюджетного сектора',
      fears: 'Ужесточение скоринга для бюджетников с невысокими официальными доходами',
      personalSituation: 'Врач-ординатор госбольницы, погашает образовательный кредит, планирует ипотеку',
      speechTone: 'Официальный', argumentation: 'Личный опыт',
      responseLength: 'Средний', typicalPhrases: 'Кто защитит бюджетников?',
    }),

    create({
      name: 'Мухтар', group: 'experts', role: 'Депутат Мажилиса', gender: 'Мужской', age: '54 года',
      dot: '#60a5fa', seatL: '80%', seatT: '65%', avatarIdx: 27,
      look: { skin: '#E2B791', hair: '#8C847B', style: 'short', outfit: '#2B3A52' },
      thinking: 'Документ принимается без должного парламентского обсуждения. Это ограничивает надзор.',
      style: 'Критический', criticality: 'Высокий', behaviorModel: 'Провокатор',
      interests: ['Парламентский контроль', 'Банковское законодательство', 'Избиратели'],
      reasoning: 'Как депутат, представляющий малые города, я вижу, что документ разработан в Астане без учёта региональной специфики. В моём регионе единственный банк — государственный. Если он вынужден поднять ставки под давлением нормативов, альтернативы у людей нет. Требую парламентских слушаний.',
      city: 'Астана', education: 'Высшее', industry: 'Госслужба', employerType: 'Госслужащий', income: 'Высокий',
      openness: 'Консервативный', decisionMaking: 'Интуитивный',
      stance: 'Неопределившийся', priority: 'Парламентский контроль и защита региональных интересов',
      fears: 'Монополия государственного банка в регионах ударит по избирателям',
      personalSituation: 'Депутат от Северного Казахстана, представляет малые города и сельские районы',
      speechTone: 'Официальный', argumentation: 'Ссылки на авторитеты',
      responseLength: 'Развёрнутый', typicalPhrases: 'Требую парламентских слушаний',
    }),

    create({
      name: 'Балжан', group: 'population', role: 'Учительница на пенсии', gender: 'Женский', age: '62 года',
      dot: '#fbbf24', seatL: '10%', seatT: '80%', avatarIdx: 28,
      look: { skin: '#F1CFB4', hair: '#C9C4BE', style: 'bun', outfit: '#7A5C4F', glasses: true },
      thinking: 'Всю жизнь копила. Теперь боюсь, что пенсионные накопления обесценятся снова.',
      style: 'Эмоциональный', criticality: 'Низкий', behaviorModel: 'Защитник интересов',
      interests: ['Пенсионные накопления', 'Инфляция', 'Стабильность'],
      reasoning: 'Я 35 лет учила детей и откладывала деньги. В 90-е потеряла всё из-за банковского кризиса. Сейчас снова страшно. Если банки должны держать больше капитала — это хорошо, значит они надёжнее. Но я хочу гарантию: если банк всё равно закроется, государство вернёт мои накопления полностью.',
      city: 'Шымкент', education: 'Высшее', industry: 'Образование', employerType: 'Пенсионер', income: 'Низкий',
      openness: 'Консервативный', decisionMaking: 'Эмоциональный',
      stance: 'Поддерживает', priority: 'Гарантия возврата пенсионных накоплений при банкротстве банка',
      fears: 'Потерять накопления снова, как в 90-е',
      personalSituation: 'Пенсионерка, накопления в двух банках, живёт одна',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'В 90-е я уже всё потеряла',
    }),

    create({
      name: 'Айдос', group: 'population', role: 'Таксист', gender: 'Мужской', age: '33 года',
      dot: '#2dd4bf', seatL: '45%', seatT: '75%', avatarIdx: 29,
      look: { skin: '#E6BC97', hair: '#1F1A16', style: 'short', outfit: '#444C55' },
      thinking: 'Брал кредит на машину под 25%. Теперь говорят, ставки могут ещё вырасти? За что?',
      style: 'Прагматичный', criticality: 'Средний', behaviorModel: 'Скептик',
      interests: ['Потребительский кредит', 'Гиг-экономика', 'Справедливость'],
      reasoning: 'Работаю в такси через приложение, официально самозанятый. Взял кредит на машину — это мой инструмент заработка. Ставка 25% уже убивает маржу. Если банки поднимут ещё — не смогу обслуживать долг. Почему в Казахстане ставки по кредитам такие высокие, а банки всё равно говорят, что им нужно больше капитала?',
      city: 'Алматы', education: 'Среднее', industry: 'Другое', employerType: 'Самозанятый', income: 'Средний',
      openness: 'Нейтральный', decisionMaking: 'Прагматичный',
      stance: 'Против', priority: 'Снижение ставок по автокредитам для самозанятых',
      fears: 'Рост ставок сделает автокредит нерентабельным для работы в такси',
      personalSituation: 'Водитель такси, кредит на автомобиль под 25%, жена и ребёнок',
      speechTone: 'Разговорный', argumentation: 'Личный опыт',
      responseLength: 'Краткий', typicalPhrases: 'За что я плачу 25%?',
    }),

    create({
      name: 'Сабина', group: 'population', role: 'Студентка-медик', gender: 'Женский', age: '20 лет',
      dot: '#fb923c', seatL: '60%', seatT: '25%', avatarIdx: 30,
      look: { skin: '#F8DCC6', hair: '#2E211A', style: 'long', outfit: '#3E9C8C' },
      thinking: 'Нас в группе 30 человек. У половины образовательные кредиты. Если подорожают — кто-то бросит учёбу.',
      style: 'Эмоциональный', criticality: 'Низкий', behaviorModel: 'Наблюдатель',
      interests: ['Доступность образования', 'Молодёжь', 'Здравоохранение'],
      reasoning: 'Учусь на 2-м курсе медицины. Мои родители не могут полностью оплатить учёбу, поэтому образовательный кредит — единственный вариант. Ставка уже 11%, что для студента немало. Если банки поднимут ставки — часть однокурсников просто не сможет продолжать учёбу. Стране нужны врачи, а не дорогие кредиты.',
      city: 'Алматы', education: 'Высшее (в процессе)', industry: 'Здравоохранение', employerType: 'Студент', income: 'Низкий',
      openness: 'Прогрессивный', decisionMaking: 'Эмоциональный',
      stance: 'Против', priority: 'Сохранение низких ставок по образовательным кредитам',
      fears: 'Рост ставок вынудит студентов бросать учёбу',
      personalSituation: 'Студентка медуниверситета, образовательный кредит, подрабатывает санитаркой',
      speechTone: 'Разговорный', argumentation: 'Эмоции',
      responseLength: 'Краткий', typicalPhrases: 'Стране нужны врачи, а не дорогие кредиты',
    }),

    create({
      name: 'Жандос', group: 'experts', role: 'Менеджер банка', gender: 'Мужской', age: '41 год',
      dot: '#818cf8', seatL: '30%', seatT: '70%', avatarIdx: 31,
      look: { skin: '#E9BE98', hair: '#282220', style: 'short', outfit: '#2F4F7C' },
      thinking: 'Нас заставят выдавать меньше кредитов. Планы продаж упадут. Это моя зарплата.',
      style: 'Прагматичный', criticality: 'Средний', behaviorModel: 'Сторонник',
      interests: ['Банковские продажи', 'Кредитный портфель', 'Мотивация сотрудников'],
      reasoning: 'Работаю в рознице банка. Мои KPI — объём выданных кредитов и качество портфеля. Новые нормативы заставят банк ужесточить скоринг и снизить объёмы. Хорошо, что это уменьшит NPL, но планы продаж никто не пересмотрит. Сотрудники окажутся между нормативным давлением и коммерческими задачами.',
      city: 'Алматы', education: 'Высшее', industry: 'Финансы', employerType: 'Частный бизнес', income: 'Средний',
      openness: 'Нейтральный', decisionMaking: 'Прагматичный',
      stance: 'Нейтральный', priority: 'Адаптация коммерческих показателей банка к новым нормативам',
      fears: 'Противоречие между нормативным давлением и коммерческими KPI',
      personalSituation: 'Менеджер по розничному кредитованию, бонус зависит от объёма выдачи',
      speechTone: 'Официальный', argumentation: 'Личный опыт',
      responseLength: 'Средний', typicalPhrases: 'Планы никто не пересмотрит',
    }),

    // ── Этап 1 (оценки персон): две персоны, которых не хватало группам ──
    // Утверждены 03.11.2026, профили — .ai/PERSONA-GROUPS.md.

    create({
      name: 'Даниэль Хартманн', group: 'experts', role: 'Управляющий фондом облигаций развивающихся рынков',
      gender: 'Мужской', age: '46 лет',
      dot: '#2dd4bf', seatL: '70%', seatT: '80%', avatarIdx: 32,
      look: { skin: '#F2D3BC', hair: '#8A6E52', style: 'short', outfit: '#2B3A52', glasses: true },
      thinking: 'Насколько предсказуема траектория ставки и можно ли доверять прогнозам регулятора? От этого зависит, сколько тенговых облигаций мы держим.',
      style: 'Аналитический', criticality: 'Высокий', behaviorModel: 'Скептик',
      interests: ['Предсказуемость ставки', 'Курс тенге', 'Независимость регулятора', 'Качество прогнозов'],
      reasoning: 'Я сравниваю коммуникацию НБК с ФРС и ЕЦБ: у них решение, его причины и условия следующих шагов видны в первом абзаце. Если сигнал о ставке размыт, а прогнозы часто пересматриваются, я закладываю премию за риск и сокращаю позицию в тенге. Мне важно видеть, что регулятор действует независимо от бюджета.',
      city: 'Лондон', education: 'Научная степень', industry: 'Финансы', employerType: 'Частный бизнес', income: 'Высокий',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Нейтральный', priority: 'Предсказуемость денежно-кредитной политики и курса тенге для инвесторов в облигации',
      fears: 'Неожиданные развороты ставки, влияние бюджета на решения регулятора, ошибки прогнозов',
      personalSituation: 'Управляет фондом облигаций развивающихся рынков в Лондоне, держит казахстанские ГЦБ и ноты НБК, читает документы НБК через машинный перевод',
      speechTone: 'Официальный', argumentation: 'Ссылки на авторитеты', responseLength: 'Средний',
      typicalPhrases: 'Для сравнения, ФРС в такой ситуации прямо называет условия; рынок закладывает это в цену',
      contexts: { create: [{ src: 'Пресс-релиз · последний абзац', quote: '…пространство для дальнейшего снижения ограничено.' }] },
    }),

    create({
      name: 'Айгерим', group: 'business', role: 'Финансовый директор',
      gender: 'Женский', age: '43 года',
      dot: '#fb923c', seatL: '35%', seatT: '85%', avatarIdx: 33,
      look: { skin: '#EFC5A2', hair: '#2A1C17', style: 'bob', outfit: '#1F6347' },
      thinking: 'Какой будет ставка через полгода и куда пойдёт курс? Мне нужно решить, поднимать ли отпускные цены и брать ли кредит на закупку сейчас.',
      style: 'Прагматичный', criticality: 'Высокий', behaviorModel: 'Скептик',
      interests: ['Стоимость оборотных кредитов', 'Курс тенге', 'Отпускные цены', 'Планирование закупок'],
      reasoning: 'Я отвечаю за финансы компании, которая производит молочную продукцию и торгует импортным сырьём. Половина затрат зависит от курса, оборотный кредит мы рефинансируем каждый квартал. Из документа мне нужно понять, снизится ли ставка и когда, — от этого зависит, закладывать ли рост цен в прайс и брать ли кредит сейчас или ждать.',
      city: 'Караганда', education: 'MBA', industry: 'МСБ', employerType: 'Частный бизнес', income: 'Высокий',
      openness: 'Нейтральный', decisionMaking: 'Аналитический',
      stance: 'Нейтральный', priority: 'Стоимость и доступность оборотных кредитов, предсказуемость курса для планирования цен и закупок',
      fears: 'Рост ставки по оборотному кредиту, скачок курса, при котором придётся резко поднимать цены и терять покупателей',
      personalSituation: 'Финансовый директор компании на 220 сотрудников: производство молочной продукции и оптовая торговля, импортное сырьё и упаковка, квартальный оборотный кредит в двух банках',
      speechTone: 'Официальный', argumentation: 'Факты и цифры', responseLength: 'Средний',
      typicalPhrases: 'Мне нужна цифра и срок, а не «при необходимости»; это сразу уходит в себестоимость',
      contexts: { create: [{ src: 'Пресс-релиз · непродовольственная инфляция', quote: '…на фоне укрепления обменного курса теңге.' }] },
    }),

  ]);

  return results.filter(Boolean).length;
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
