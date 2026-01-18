# Project Rules

## Language
- Общайся на русском языке

## Key Documentation
Перед работой изучи эти файлы:
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — архитектура, Docker, порты, деплой, troubleshooting
- [FRONTEND_API_CONVENTIONS.md](FRONTEND_API_CONVENTIONS.md) — правила API, избегаем `/api/api/` дублирования
- [LOCAL_VS_PRODUCTION_ANALYSIS.md](LOCAL_VS_PRODUCTION_ANALYSIS.md) — различия local vs prod окружений

## Permissions & Access
- **НЕ подключайся к production серверу** — никаких SSH, remote команд
- **НЕ подключайся к Supabase напрямую** — миграции применяю сам
- **НЕ выполняй миграции** — только создавай файлы в `migrations/`, я применю сам
- Даёшь команды — я выполняю на проде

## Project Structure
Monorepo с микросервисами:
- `services/frontend` — React + TypeScript (Vite), порт 3001
- `services/agent-service` — Fastify + TypeScript, API бэкенд, порт 8082
- `services/agent-brain` — Node.js, AI-агент для Facebook Ads
- `services/creative-generation-service` — генерация креативов (Gemini)
- `services/chatbot-service` — WhatsApp чатбот
- `services/crm-backend` / `crm-frontend` — CRM система

## Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Backend**: Fastify, TypeScript, Node.js
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **AI**: OpenAI GPT-4o, Gemini, Claude
- **Ads**: Facebook Marketing API
- **Messaging**: Evolution API (WhatsApp)
- **Infra**: Docker Compose, Nginx

## Local Development
```bash
# Запуск frontend
cd services/frontend && npm run dev

# Запуск agent-service
cd services/agent-service && npm run dev

# Docker (полный стек)
docker-compose up -d
```

## Database
- Local dev: Docker PostgreSQL (docker-compose.local.yml)
- Production: Supabase
- Миграции: `migrations/*.sql` — нумерация 001, 002, ...

## Git
- Main branch: `main`
- Коммить без лишних вопросов, если я попросил
- Пуш на remote только по явной просьбе

## Ads Agent
При работе с рекламой Facebook/Instagram через MCP используй:
- Главная инструкция: [.claude/ads-agent/AGENT.md](.claude/ads-agent/AGENT.md)
- Конфигурация аккаунтов: [.claude/ads-agent/config/ad_accounts.md](.claude/ads-agent/config/ad_accounts.md)
- Skills: `/ads-optimizer`, `/campaign-manager`, `/ads-reporter`, `/creative-analyzer`, `/targeting-expert`
