#!/bin/bash
# Скрипт диагностики проблем с загрузкой больших видео (>100MB)

echo "================================"
echo "ДИАГНОСТИКА ЗАГРУЗКИ ВИДЕО"
echo "================================"
echo ""

# 1. Проверка tmpfs
echo "1. Проверка /tmp (tmpfs = плохо, нужен диск):"
echo "-------------------------------------------"
mount | grep -E '/tmp|nginx' || echo "tmpfs не найден"
df -h /tmp
echo ""

# 2. Проверка свободного места
echo "2. Свободное место на диске:"
echo "----------------------------"
df -h / /var /tmp
echo ""

# 3. Проверка памяти и swap
echo "3. Память и SWAP:"
echo "-----------------"
free -h
swapon --show || echo "⚠️  SWAP НЕ НАСТРОЕН!"
echo ""

# 4. Проверка OOM в логах
echo "4. Поиск OOM kills (Out Of Memory) за последние 24ч:"
echo "----------------------------------------------------"
journalctl --since "24 hours ago" -k | grep -i -E "killed process|out of memory|oom" | tail -20 || echo "OOM kills не найдены"
echo ""

# 5. Проверка nginx настроек
echo "5. Nginx лимиты (должно быть ≥300m):"
echo "------------------------------------"
if [ -f /etc/nginx/sites-available/default ]; then
    grep -E "client_max_body_size|client_body_temp_path|proxy_request_buffering" /etc/nginx/sites-available/default 2>/dev/null || echo "Лимиты не найдены в default"
fi
if [ -f /etc/nginx/nginx.conf ]; then
    grep -E "client_max_body_size|client_body_temp_path" /etc/nginx/nginx.conf 2>/dev/null || echo "Лимиты не найдены в nginx.conf"
fi
echo ""

# 6. Проверка Docker контейнеров (если используются)
echo "6. Docker контейнеры и лимиты памяти:"
echo "--------------------------------------"
if command -v docker &> /dev/null; then
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" 2>/dev/null || echo "Docker не запущен"
    echo ""
    echo "Лимиты памяти контейнеров:"
    docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null || echo "Нет запущенных контейнеров"
    echo ""
    # Проверка tmpfs внутри контейнера agent-service
    echo "Проверка /tmp внутри контейнера agent-service:"
    docker exec agent-service df -h /tmp 2>/dev/null || echo "Контейнер agent-service не найден"
else
    echo "Docker не установлен или не используется"
fi
echo ""

# 7. Проверка текущих процессов Node.js
echo "7. Node.js процессы и их память:"
echo "--------------------------------"
ps aux | grep -E "node|PID" | grep -v grep | awk '{printf "%-20s %-10s %-10s %s\n", $11, $4"%", $6/1024"MB", $12}' | head -20
echo ""

# 8. Проверка логов nginx на ошибки
echo "8. Последние ошибки nginx (если есть):"
echo "--------------------------------------"
if [ -f /var/log/nginx/agents_error.log ]; then
    tail -30 /var/log/nginx/agents_error.log | grep -i -E "client intended to send too large|upstream|timeout|error" || echo "Ошибок не найдено"
else
    echo "Лог /var/log/nginx/agents_error.log не найден"
fi
echo ""

# Итоги и рекомендации
echo "================================"
echo "РЕКОМЕНДАЦИИ:"
echo "================================"
echo ""

# Проверка tmpfs
if mount | grep -q "tmpfs on /tmp"; then
    echo "❌ /tmp смонтирован как tmpfs (RAM) - это ГЛАВНАЯ ПРОБЛЕМА!"
    echo "   Решение: изменить код, чтобы писать в /var/tmp (диск)"
    echo ""
fi

# Проверка swap
if ! swapon --show &> /dev/null; then
    echo "⚠️  SWAP не настроен - добавь 4GB для подстраховки"
    echo "   Команда: см. ниже в разделе 'Быстрый фикс'"
    echo ""
fi

# Проверка OOM
if journalctl --since "24 hours ago" -k | grep -q -i "out of memory"; then
    echo "❌ Найдены OOM kills - сервер убивает процессы из-за нехватки памяти!"
    echo "   Основная причина: код загружает файл целиком в память (toBuffer)"
    echo ""
fi

echo "================================"
echo "БЫСТРЫЙ ФИКС (если нет swap):"
echo "================================"
echo "sudo fallocate -l 4G /swapfile"
echo "sudo chmod 600 /swapfile"
echo "sudo mkswap /swapfile"
echo "sudo swapon /swapfile"
echo "echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
echo ""
echo "================================"

