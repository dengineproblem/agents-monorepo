# Chat Assistant Architecture

## Overview

Meta-Tools архитектура для обработки запросов пользователей через специализированных доменных агентов.

## Flow

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────┐
│         orchestrator/index.js                    │
│  - Memory commands (запомни/забудь/заметки)     │
│  - Context gathering (integrations, specs)       │
│  - Route to MetaOrchestrator                     │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│         MetaOrchestrator (GPT-5.2)              │
│         metaOrchestrator.js                      │
│                                                  │
│  META_TOOLS:                                     │
│  - getAvailableDomains() → список доменов       │
│  - getDomainTools(domain) → tools домена        │
│  - executeTools([...]) → выполнение + агент     │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│              domainRouter.js                     │
│  - Группирует tools по доменам                  │
│  - Выполняет tools параллельно                  │
│  - Вызывает domain agents для каждого домена    │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│         domainAgents.js (GPT-4o-mini)           │
│  - Получает raw data от tools                   │
│  - Получает user question + context             │
│  - Формирует человеческий ответ                 │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
            Final Response → User
```

## Domains

| Domain | Description | Tools |
|--------|-------------|-------|
| `ads` | Facebook/Instagram реклама | getCampaigns, getSpendReport, pauseCampaign, etc. |
| `creative` | Креативы и их анализ | getCreatives, getCreativeMetrics, launchCreative, etc. |
| `crm` | Лиды и воронка продаж | getLeads, getFunnelStats, updateLeadStage, etc. |
| `whatsapp` | WhatsApp диалоги | getDialogs, analyzeDialog, searchDialogSummaries, etc. |

## Key Files

### Entry Points
- `index.js` — API endpoints (/api/brain/chat, /api/brain/chat/stream)
- `orchestrator/index.js` — Main orchestrator with context gathering

### Meta-Tools Architecture
- `orchestrator/metaOrchestrator.js` — GPT-5.2 orchestrator with tool loop
- `orchestrator/metaSystemPrompt.js` — System prompt for orchestrator
- `metaTools/definitions.js` — META_TOOLS (getAvailableDomains, getDomainTools, executeTools)
- `metaTools/domainRouter.js` — Routes tools to domains, calls domain agents
- `metaTools/domainAgents.js` — GPT-4o-mini agents for data processing
- `metaTools/executor.js` — Executes individual tools
- `metaTools/formatters.js` — Formats tools for LLM

### Domain Handlers
- `agents/ads/handlers.js` — Facebook Ads API handlers
- `agents/creative/handlers.js` — Creative management handlers
- `agents/crm/handlers.js` — amoCRM integration handlers
- `agents/whatsapp/handlers.js` — WhatsApp dialog handlers

### Stores
- `stores/memoryStore.js` — User notes and specs
- `stores/unifiedStore.js` — Conversations and plans
- `stores/runsStore.js` — LLM run tracking

## Configuration

Environment variables:
```
META_ORCHESTRATOR_MODEL=gpt-5.2      # Model for orchestrator
DOMAIN_AGENT_MODEL=gpt-4o-mini       # Model for domain agents
META_MAX_ITERATIONS=10               # Max tool call iterations
ORCHESTRATOR_DEBUG=true              # Enable debug logging
```

## Adding New Tools

1. Add handler in `agents/{domain}/handlers.js`
2. Add tool definition in `agents/{domain}/toolDefs.js`
3. Register in `mcp/tools/definitions.js`

## Memory Commands

Direct commands (handled before LLM):
- `запомни: ...` — Save note
- `забудь: ...` — Delete note
- `заметки` — List all notes
