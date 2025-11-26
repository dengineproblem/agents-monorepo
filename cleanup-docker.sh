#!/bin/bash
# Очистка неиспользуемых Docker образов и контейнеров
# Рекомендуется запускать еженедельно через cron

set -e

echo "🧹 Docker cleanup started: $(date)"
echo "================================="

# Показать текущее использование диска
echo ""
echo "📊 Disk usage BEFORE cleanup:"
docker system df

echo ""
echo "🗑️  Removing stopped containers..."
docker container prune -f

echo ""
echo "🗑️  Removing dangling images..."
docker image prune -f

echo ""
echo "🗑️  Removing unused images (older than 168h = 7 days)..."
docker image prune -a --filter "until=168h" -f

# ОСТОРОЖНО: Удаление неиспользуемых volumes может удалить важные данные!
# Раскомментируйте следующую строку только если уверены:
# echo ""
# echo "🗑️  Removing unused volumes..."
# docker volume prune -f

echo ""
echo "✅ Docker cleanup completed: $(date)"
echo "================================="
echo ""
echo "📊 Disk usage AFTER cleanup:"
docker system df

echo ""
echo "💾 Saved space calculation:"
echo "(compare BEFORE and AFTER to see how much space was freed)"









