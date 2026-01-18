# Claude Ads Agent

Автономный AI-агент для управления Facebook рекламой на базе Claude Code.

**Создан:** 2026-01-18

---

## Обзор

Claude Ads Agent — это альтернативная система управления рекламой, работающая полностью локально через Claude Code. В отличие от Agent Brain (серверное решение с GPT), этот агент:

- Работает локально без сервера
- Использует MD-файлы вместо базы данных
- Принимает решения агентски (не детерминированный код)
- Интегрируется с Facebook через MCP сервер meta-ads

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE ADS AGENT                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 CLAUDE CODE (мозг)                        │  │
│  │  • Читает конфигурацию из MD файлов                      │  │
│  │  • Применяет знания из Skills                            │  │
│  │  • Принимает решения агентски                            │  │
│  │  • Выполняет действия через MCP                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│          ↓                    ↓                    ↓            │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │  CONFIG FILES  │  │    SKILLS      │  │   MCP SERVER     │  │
│  │  (MD файлы)    │  │  (знания)      │  │  (инструменты)   │  │
│  ├────────────────┤  ├────────────────┤  ├──────────────────┤  │
│  │ ad_accounts.md │  │ ads-optimizer  │  │ meta-ads         │  │
│  │ briefs/*.md    │  │ campaign-mgr   │  │ (46 tools)       │  │
│  │                │  │ ads-reporter   │  │                  │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Структура файлов

```
.claude/
├── ads-agent/                      # Корневая папка агента
│   ├── AGENT.md                    # Главная инструкция агента
│   │
│   ├── config/                     # Конфигурация
│   │   ├── ad_accounts.md          # Список аккаунтов
│   │   └── briefs/                 # Брифы по аккаунтам
│   │       ├── _template.md        # Шаблон брифа
│   │       └── bas_dent.md         # Пример: Bas Dent
│   │
│   ├── knowledge/                  # База знаний
│   │   ├── safety_rules.md         # Правила безопасности
│   │   ├── metrics_glossary.md     # Глоссарий метрик
│   │   ├── fb_best_practices.md    # Best practices
│   │   └── troubleshooting.md      # Решение проблем
│   │
│   └── history/                    # История действий (опционально)
│
└── skills/                         # Skills агента
    ├── ads-optimizer/SKILL.md      # Оптимизация, Health Score
    ├── campaign-manager/SKILL.md   # Создание кампаний
    ├── ads-reporter/SKILL.md       # Отчёты
    ├── creative-analyzer/SKILL.md  # Анализ креативов
    └── targeting-expert/SKILL.md   # Таргетинг
```

---

## Skills

| Skill | Команда | Назначение |
|-------|---------|------------|
| **ads-optimizer** | `/ads-optimizer` | Анализ метрик, Health Score, ad-eater detection, рекомендации по бюджетам |
| **campaign-manager** | `/campaign-manager` | Создание кампаний, адсетов, объявлений, масштабирование |
| **ads-reporter** | `/ads-reporter` | Дневные/недельные отчёты, сравнение периодов |
| **creative-analyzer** | `/creative-analyzer` | Анализ креативов, A/B тесты, creative fatigue |
| **targeting-expert** | `/targeting-expert` | Поиск интересов, Lookalike, гео/демо таргетинг |

---

## Использование

### 1. Добавить аккаунт

Отредактировать `.claude/ads-agent/config/ad_accounts.md`:

```markdown
## Аккаунт 1: MyBusiness

- **ID**: act_123456789
- **Название**: MyBusiness
- **Бриф**: [briefs/mybusiness.md](briefs/mybusiness.md)
- **Статус**: активен
- **Валюта**: USD
- **Часовой пояс**: UTC+5 (Алматы)
```

### 2. Создать бриф

Скопировать `.claude/ads-agent/config/briefs/_template.md` и заполнить:

- Целевой CPL
- Направления и бюджеты
- Правила оптимизации
- Целевую аудиторию

### 3. Запросы к агенту

```
# Анализ аккаунта
"Проанализируй аккаунт Bas Dent"

# Использование skill напрямую
"/ads-optimizer для Bas Dent"
"/ads-reporter недельный отчёт"
"/targeting-expert найди интересы для стоматологии"

# Действия
"Покажи топ-5 адсетов по CPL"
"Что поставить на паузу?"
```

---

## Ключевые концепции

### Health Score

Оценка "здоровья" адсета/объявления:

```
HS = (target_CPL - actual_CPL) / target_CPL * 100
```

| Диапазон | Класс | Действие |
|----------|-------|----------|
| ≥ +25 | VERY_GOOD | Масштабировать |
| +5 до +24 | GOOD | Работает хорошо |
| -5 до +4 | NEUTRAL | Норма |
| -6 до -24 | BAD | Оптимизация |
| ≤ -25 | VERY_BAD | Пауза/снижение |

### Ad-Eater Detection

Объект который тратит бюджет без результата:

| Уровень | Порог | Действие |
|---------|-------|----------|
| Критический | CPL > 3x целевого | Пауза |
| Высокий | CPL > 2x целевого | Снизить на 50% |
| Средний | CPL > 1.5x целевого | Мониторинг |

### Правила безопасности

- Максимальное увеличение бюджета: **30%** за раз
- Максимальное уменьшение: **50%** за раз
- Минимум данных: **1000 impressions**, **3 конверсии**
- Не создавать адсеты после **18:00** по времени аккаунта

---

## Сравнение с Agent Brain

| Аспект | Agent Brain | Claude Ads Agent |
|--------|-------------|------------------|
| **Мозг** | GPT-5.2 + оркестратор | Claude Code |
| **База данных** | Supabase | MD файлы |
| **Конфигурация** | Таблицы directions | briefs/*.md |
| **Логика** | Детерминированный код | Агентские решения |
| **Деплой** | Docker сервер | Локально |
| **Зависимости** | agents-monorepo | Никаких |

---

## MCP Server (meta-ads)

Агент использует MCP сервер `meta-ads` с 46 tools для Facebook API:

**Чтение:**
- `get_campaigns`, `get_adsets`, `get_ads`
- `get_insights`, `get_ad_creatives`, `get_ad_image`
- `get_custom_audiences`

**Создание:**
- `create_campaign`, `create_adset`, `create_ad`
- `create_ad_creative`, `upload_ad_image`
- `create_lookalike_audience`

**Изменение:**
- `update_campaign`, `update_adset`, `update_ad`
- `pause_campaign`, `resume_campaign`

**Таргетинг:**
- `search_interests`, `get_interest_suggestions`
- `search_geo_locations`, `search_demographics`
- `estimate_audience_size`

---

## Требования

1. **Claude Code CLI** установлен
2. **MCP сервер meta-ads** подключен в `.mcp.json`
3. **Permissions** в `.claude/settings.local.json`:
   ```json
   "Skill(ads-optimizer)",
   "Skill(campaign-manager)",
   "Skill(ads-reporter)",
   "Skill(creative-analyzer)",
   "Skill(targeting-expert)"
   ```
4. **Перезапустить Claude Code** после настройки

---

## Changelog

### 2026-01-18: Initial Release
- Создана структура агента
- 5 skills: optimizer, campaign-manager, reporter, creative-analyzer, targeting-expert
- База знаний: safety_rules, metrics_glossary, fb_best_practices, troubleshooting
- Первый аккаунт: Bas Dent
