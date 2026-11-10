# AqylNet Backend

REST API для AqylNet Multi-Agent Feedback Engine.

## Stack

- Node.js 22 + TypeScript
- Express.js
- PostgreSQL 16
- Prisma ORM
- Zod (validation)
- Docker + Docker Compose

---

## Запуск через Docker Compose (рекомендуется)

Из корня репозитория:

```bash
# Первый запуск — сборка образа, миграция схемы, seed данных, старт сервера
docker compose up --build

# Повторные запуски (образ уже собран)
docker compose up

# В фоне
docker compose up -d

# Остановить
docker compose down

# Остановить + удалить данные БД (полный сброс)
docker compose down -v
```

После запуска:
- Backend: http://localhost:3001
- Health: http://localhost:3001/api/health
- PostgreSQL: localhost:5432 (user: postgres / password: postgres / db: aqylnet)

---

## Локальный запуск (без Docker)

Требует PostgreSQL запущенного локально.

```bash
cd backend

# 1. Установить зависимости
npm install

# 2. Скопировать и настроить .env
cp .env.example .env
# Отредактировать DATABASE_URL в .env

# 3. Применить схему к БД
npx prisma db push

# 4. Заполнить тестовыми данными
npm run db:seed

# 5. Запустить сервер в dev режиме (hot reload)
npm run dev
```

---

## Команды Prisma

```bash
# Обновить схему в БД (dev)
npm run db:migrate      # → prisma migrate dev

# Сгенерировать Prisma Client
npm run db:generate     # → prisma generate

# Заполнить тестовыми данными
npm run db:seed         # → tsx prisma/seed.ts

# Сбросить БД и пересидить
npm run db:reset        # → migrate reset + seed

# Открыть Prisma Studio
npm run db:studio       # → prisma studio
```

---

## Структура

```
src/
  config/
    env.ts        — env variables
    prisma.ts     — Prisma client singleton
  controllers/    — request handlers (Loop 3+)
  routes/
    health.ts     — GET /api/health
    index.ts      — route registry
  services/       — business logic (Loop 3+)
  repositories/   — DB access via Prisma (Loop 3+)
  middlewares/
    errorHandler.ts
    notFound.ts
  validators/     — Zod schemas (Loop 3+)
  types/
    api.ts        — ApiResponse<T>, ok(), fail()
  app.ts
  server.ts
prisma/
  schema.prisma   — Prisma schema (all models)
  seed.ts         — seed from mock data
```

---

## API Response Format

```json
{ "success": true,  "data": {},   "message": null }
{ "success": false, "data": null, "message": "Error message" }
```
