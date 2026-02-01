#!/bin/bash

# Cleanup избыточных файлов из Moltbot workspaces

echo "🧹 Начинаю очистку workspace агентов..."

# CRM Agent
if [ -f "moltbot-workspace-crm/TOOLS.md" ]; then
  rm -f moltbot-workspace-crm/TOOLS.md
  echo "✅ CRM: Удален TOOLS.md"
fi

if [ -d "moltbot-workspace-crm/skills/crm" ]; then
  rm -rf moltbot-workspace-crm/skills/crm
  echo "✅ CRM: Удалена папка skills/crm/"
fi

# Проверка результатов
echo ""
echo "📊 Результаты очистки:"
echo ""

for workspace in moltbot-workspace-{facebook,creatives,crm,tiktok,onboarding,router}; do
  echo "=== $workspace ==="
  wc -l "$workspace/AGENTS.md" 2>/dev/null || echo "AGENTS.md not found"
  find "$workspace" -name "*.md" | wc -l
  echo ""
done

echo "✅ Очистка завершена!"
