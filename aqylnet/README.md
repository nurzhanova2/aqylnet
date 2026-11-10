# AqylNet — фронтенд

Описание проекта, запуск backend и проверки — в [корневом README](../README.md).

- `npm run dev` — dev-сервер на http://localhost:5174 (прокси `/api` на `127.0.0.1:3001`)
- `npm run lint && npm test` — oxlint и vitest
- `npm run build` — сборка в `dist/`, её раздаёт nginx (сервис `web`)
