<div align="center">

# AqylNet — Multi-Agent Feedback Engine

### Виртуальная фокус-группа из AI-персон: читает документ, обсуждает его и показывает, кому он понятен

**Язык:** [English](README.md) · [Русский](README_ru.md)

[![Фронтенд — React 19 · Vite 8](https://img.shields.io/badge/фронтенд-React%2019%20·%20Vite%208-1565c0)](aqylnet/package.json)
[![Бэкенд — Node 22 · Express · Prisma](https://img.shields.io/badge/бэкенд-Node%2022%20·%20Express%20·%20Prisma-2e7d32)](backend/package.json)
[![База — PostgreSQL 16](https://img.shields.io/badge/база-PostgreSQL%2016-455a64)](backend/prisma/schema.prisma)
[![LLM — OpenAI-совместимый через LiteLLM](https://img.shields.io/badge/LLM-OpenAI--совместимый%20через%20LiteLLM-6a1b9a)](backend/src/config/env.ts)
[![Тесты — 308 unit · 74 UI · 136 живых](https://img.shields.io/badge/тесты-308%20unit%20·%2074%20UI%20·%20136%20живых-f9a825)](#3-проверки)

</div>

> [!IMPORTANT]
> AqylNet — внутренний аналитический инструмент: интерфейс и промпты на русском, модель вызывается через корпоративный прокси LiteLLM. Проекты разделены заголовком `X-Session-Key`, который генерирует браузер, — это **разделение рабочих пространств, а не аутентификация**. Не открывать сервис за пределы доверенной сети.

## О проекте

Пользователь загружает документ (PDF, DOCX, DOC, TXT, MD) или вставляет текст, выбирает 1–8 персон из библиотеки в 34 — население, бизнес, эксперты и посредники — и запускает обсуждение по раундам. Каждая персона отвечает из своей социальной, профессиональной и психологической позиции, читает документ целиком и реагирует на других.

```text
документ → разделы → состав и позиции → раунды дискуссии → отчёт и аудит по разделам → оценки персон → кому понятен текст → три версии текста
```

Всё, что утверждает модель, проверяет код: цитата аудита должна быть в документе дословно, итоговый балл и все вердикты вычисляются, а не запрашиваются, а недоверенный ввод (документ, стенограмма, поля персон) в каждом промпте отделён от инструкций.

> [!WARNING]
> Персоны — моделирование, а не опрос. Отчёты и переписанные тексты — черновики для автора: код сверяет с документом числа, цитаты и решение, но не связи между фактами. Где документ молчит, в каждой версии стоит заглушка `[Дописать: …]`.

## Что получается на выходе

| Блок | Содержание | Кто решает |
|---|---|---|
| Дискуссия | раунды в трёх режимах — Round Table, Дебаты, Интервью; вопрос модератора в каждом раунде | модель |
| Отчёт | настроение, риски, рекомендации, темы с весами, альтернативная редакция с тегами «без изм. / изменено / добавлено» | модель, проверка Zod |
| Аудит документа | четыре оси, замечания с severity и дословной цитатой, проверочный список обязательного содержания, карта разделов, «задумано и понято» | модель приносит доказательство, код сливает и ограничивает балл |
| Оценки участников | каждая персона оценивает каждый раздел по шкале 1–10 — до дискуссии и без неё | модель по каждой персоне; средние, разброс и разница групп — код |
| Кому понятен текст | уровень понимания по группам, разрыв с целевой аудиторией, как поняли решение, каких объяснений не хватает | код, модель только извлекает |
| Три версии текста | карточка для населения, справка для бизнеса и журналистов, полный текст с точечными правками для экспертов | модель пишет черновик, код применяет правки и ставит пометки |

Отчёт и каждая версия экспортируются в PDF и DOCX; пометки проверки доезжают до экспорта и до буфера обмена.

## Быстрый старт

### 1. Запуск

```bash
cp .env.example .env               # заполнить POSTGRES_PASSWORD и LLM_API_KEY
docker compose up -d --build       # postgres + backend (production-образ)
RUN_SEED=true docker compose up -d backend   # один раз на пустой базе: 34 персоны
docker compose up -d backend                 # вернуть сид выключенным

cd aqylnet && npm install && npm run dev     # dev-интерфейс → http://localhost:5174
# или тонкий фронтенд для сети:
cd aqylnet && npm run build && docker compose up -d web   # → http://<хост>:8080
```

- К backend обращаться по **`127.0.0.1`**, а не `localhost`: на этой машине `localhost` резолвится в `::1`, а Docker публикует порты на IPv4.
- Правка `backend/src` требует `docker compose up -d --build backend`; `restart` оставит старый скомпилированный `dist/`.
- Схема меняется только миграциями (`prisma migrate deploy` выполняется на старте).

### 2. Настройка

Секреты — в **корневом `.env`**, и только там. Все необязательные параметры — лимиты запросов и их окна, `max_tokens` каждого из 17 LLM-сценариев, окно модели, таймауты, суточный потолок токенов, выключатель поиска противоречий — перечислены с дефолтами в [`.env.example`](.env.example). Compose передаёт их все в контейнер; пустое значение означает дефолт из [`limits.ts`](backend/src/config/limits.ts). Менять в `.env` и выполнять `docker compose up -d backend` — без пересборки.

Токен и модель меняются вместе. Проверить пару до того, как ей доверять:

```bash
docker compose cp scripts/check-llm-model.mjs backend:/tmp/check.mjs
docker compose exec backend node /tmp/check.mjs
```

### 3. Проверки

```bash
cd backend && npm run build && npm run test:unit     # проверка типов вместе с тестами, сборка, 308 тестов
cd aqylnet && npm run lint && npm test && npm run build   # 74 теста
```

Живым наборам нужны работающие backend и PostgreSQL, а переменные — **в том же окне терминала**:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:3001/api'
$env:TEST_DATABASE_URL = 'postgresql://postgres:<пароль>@127.0.0.1:5432/aqylnet?schema=public'
cd tests; npm run test:api; npm run test:security       # 125 тестов
$env:APP_URL = 'http://127.0.0.1:8080'; npm run test:e2e # 11 тестов в браузере
```

В bash — через `export`. У `TEST_DATABASE_URL` нет значения по умолчанию; на время прогона расширить `RATE_LIMIT_*` в корневом `.env` и потом вернуть — подробно в [`.env.test.example`](.env.test.example).

## Ограничения

| Параметр | Значение |
|---|---:|
| Персон в дискуссии | 1–8 |
| Раундов | 1–10, по умолчанию 5 |
| Ключевых сообщений автора | до 3 |
| Загружаемый файл | до 20 МБ |
| Хранимый текст документа | до 500 000 символов, сверх — усечение с отметкой |
| Документ, который персоны читают целиком | ~96 000 символов (~20 стр. сплошного текста, ~37 стр. доклада с графиками); длиннее → 400 |
| Продуктовая рамка, на которую рассчитаны замеры | ~15 страниц |
| Одновременных раундов на сервер | 6 |
| Суточный потолок токенов | 10 000 000 |

Второй одновременный запуск долгой LLM-операции того же проекта — раунда, отчёта, оценок персон, анализа аудитории, версий текста — получает **409**, а не оплачивается дважды.

<details>
<summary><b>API — 33 endpoint-а с префиксом <code>/api</code></b></summary>

```text
GET    /health                                 503, если нет базы или ключа
GET    /personas · GET /personas/:id · POST /personas · PATCH /personas/:id · DELETE /personas/:id
POST   /suggest/personas                       LLM подбирает состав
POST   /documents/upload · POST /documents/text
GET    /projects · POST /projects              создание проекта считает позиции персон (LLM)
GET    /projects/:id · PATCH /projects/:id · DELETE /projects/:id
GET    /projects/:id/personas · POST /projects/:id/personas · DELETE /projects/:id/personas/:personaId
GET    /projects/:id/timeline · POST /projects/:id/timeline · PATCH /projects/:id/timeline/:messageId
GET    /projects/:id/summary · PUT /projects/:id/summary
GET    /projects/:id/analytics · PUT /projects/:id/analytics
POST   /projects/:id/run-iteration             один раунд (LLM)
POST   /projects/:id/generate-report           отчёт и аудит (LLM)
POST   /projects/:id/persona-scores · GET …    оценки персон (LLM)
POST   /projects/:id/audience-analysis · GET … кому понятен текст (LLM); 409 без оценок
POST   /projects/:id/rewrites · POST /projects/:id/rewrites/:layer · GET …   три версии (LLM)
```

Каждый ответ — `{ "success": …, "data": …, "message": … }`. Проект чужого рабочего пространства отдаёт 404, а не 403.

</details>

## Структура

```text
.
├── aqylnet/              # фронтенд на React: страницы, сцены, блоки отчёта, экспорт PDF/DOCX
├── backend/
│   ├── prisma/           # 13 моделей, миграции, seed (34 персоны)
│   ├── certs/            # корень перехватывающего прокси (публичный)
│   └── src/
│       ├── config/       # env, limits.ts (все числовые границы с замерами), шкалы, словарь терминов
│       ├── routes/ controllers/ validators/ repositories/
│       ├── services/     # llm.service.ts (17 сценариев), раунды, аудит, оценки, аудитория, версии
│       ├── middlewares/  # лимиты, session key, доступ к проекту
│       ├── workers/      # разбор документов в worker_threads с таймаутом и потолком памяти
│       └── utils/        # подпись файла, скрининг DOCX, семафор, single-flight
├── tests/                # живые наборы API, security и E2E на Playwright
├── scripts/              # проверка модели, замеры
├── deploy/nginx.conf     # тонкий фронтенд: статика + прокси /api
└── docker-compose.yml    # postgres + backend + web
```

Слои backend: `routes → controllers → services → repositories → Prisma`. Тема интерфейса — Graphite Green; все цветовые токены — в [`variables.css`](aqylnet/src/styles/variables.css).

## Документация

- [`.env.example`](.env.example) — все переменные окружения с дефолтами;
- [`.env.test.example`](.env.test.example) — окружение живых наборов тестов, PowerShell и bash;
- [`backend/src/config/limits.ts`](backend/src/config/limits.ts) — все числовые границы, у каждой — замер, из которого она получена;
- [`backend/certs/README.md`](backend/certs/README.md) — корень прокси и его обновление.

Локальные рабочие заметки — в `.ai/`, эта папка в `.gitignore`.
