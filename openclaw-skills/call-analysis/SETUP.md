# Настройка OpenClaw: Анализ записей звонков

## Схема

```
Консультант записал звонок
  → crm-backend: Whisper транскрипция → БД (analysis_status = pending)
  → OpenClaw (крон каждые 5 мин): проверяет pending → анализирует → PATCH в БД
  → Фронтенд: подхватывает через polling
```

## Шаг 1: Скопировать skill на сервер

С Mac:
```bash
scp openclaw-skills/call-analysis/SKILL.md root@147.182.186.15:/tmp/call-analysis-skill.md
```

На сервере (от root):
```bash
mkdir -p /home/openclaw/.openclaw/workspace/skills/call-analysis
cp /tmp/call-analysis-skill.md /home/openclaw/.openclaw/workspace/skills/call-analysis/SKILL.md
chown -R openclaw:openclaw /home/openclaw/.openclaw/workspace/skills/call-analysis
```

## Шаг 2: Добавить в AGENTS.md

В `/home/openclaw/.openclaw/workspace/AGENTS.md`, в секцию skills добавить:

```
- call-analysis/SKILL.md  # Анализ записей звонков консультантов
```

## Шаг 3: Настроить крон

От root на сервере:

```bash
crontab -u openclaw -e
```

Добавить строку (каждые 5 минут):
```cron
*/5 * * * * /home/openclaw/check-recordings.sh >> /home/openclaw/check-recordings.log 2>&1
```

Создать скрипт `/home/openclaw/check-recordings.sh`:
```bash
#!/bin/bash
# Проверяем есть ли ожидающие записи, если да — запускаем анализ

export PATH="/home/openclaw/.nvm/versions/node/$(ls /home/openclaw/.nvm/versions/node/)/bin:$PATH"

PENDING=$(curl -s http://localhost:8084/admin/call-recordings/pending-analysis \
  -H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d" | jq -r '.recordings | length')

if [ "$PENDING" -gt 0 ] 2>/dev/null; then
  echo "$(date): Found $PENDING pending recordings, triggering OpenClaw"
  echo "Проанализируй новые записи звонков" | openclaw chat --no-interactive 2>&1
else
  # Тихо, ничего не логируем если записей нет
  :
fi
```

```bash
chmod +x /home/openclaw/check-recordings.sh
chown openclaw:openclaw /home/openclaw/check-recordings.sh
```

## Шаг 4: Перезапустить gateway

```bash
su - openclaw -s /bin/bash -c "source ~/.nvm/nvm.sh && openclaw gateway stop"
su - openclaw -s /bin/bash -c "source ~/.nvm/nvm.sh && nohup openclaw gateway > ~/.openclaw/gateway.log 2>&1 &"
```

## Проверка

1. `su - openclaw -s /bin/bash -c "bash /home/openclaw/check-recordings.sh"` — должен показать 0 pending
2. Записать тестовый звонок через CRM, дождаться транскрипции
3. Запустить скрипт ещё раз — должен найти 1 pending и запустить анализ
4. Через пару минут проверить в CRM: вкладка Записи → анализ должен появиться
