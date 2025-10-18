#!/bin/bash

# Тестовый скрипт для production webhook
# Использует реальный домен agents.performanteaiagency.com

set -e

# Цвета
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}ℹ️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

# Конфигурация
API_URL="https://agents.performanteaiagency.com"
VIDEO_FILE=${1:-"./test-video.mp4"}

print_info "🚀 Тестирование Video Processing API"
echo "API URL: $API_URL"
echo "Видео файл: $VIDEO_FILE"
echo ""

# Проверка файла
if [ ! -f "$VIDEO_FILE" ]; then
    print_error "Видео файл не найден: $VIDEO_FILE"
    print_info "Использование: ./test-video-production.sh [путь_к_видео]"
    print_info "Или создайте тестовое видео командой:"
    echo "  ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -f lavfi -i sine=frequency=1000:duration=10 -pix_fmt yuv420p test-video.mp4"
    exit 1
fi

# 1. Health check
print_info "Проверка health endpoint..."
HEALTH_RESPONSE=$(curl -s "$API_URL/health" || echo '{"error":"failed"}')
if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
    print_info "✅ Сервис работает"
else
    print_error "Сервис не отвечает"
    echo "Ответ: $HEALTH_RESPONSE"
    exit 1
fi

echo ""

# Параметры (все берутся из user_accounts в Supabase)
USER_ID=${USER_ID:-""}
TITLE=${TITLE:-"Тестовый креатив $(date +%Y%m%d_%H%M%S)"}
DESCRIPTION=${DESCRIPTION:-"Это тестовое описание видео креатива для проверки работы сервиса"}
LANGUAGE=${LANGUAGE:-"ru"}
CLIENT_QUESTION=${CLIENT_QUESTION:-"Здравствуйте! Интересует ваше предложение."}
SITE_URL=${SITE_URL:-"https://performanteaiagency.com"}
UTM=${UTM:-"utm_source=facebook&utm_medium=video&utm_campaign=test"}

print_warning "Параметры запроса:"
echo "  USER_ID: $USER_ID"
echo "  TITLE: $TITLE"
echo ""

# Проверка user_id
if [ -z "$USER_ID" ]; then
    print_error "USER_ID не установлен!"
    echo "Экспортируйте переменную:"
    echo "  export USER_ID='ваш_user_id_из_supabase'"
    echo ""
    echo "Все остальные данные (токены, ad_account_id, page_id, instagram_id)"
    echo "будут автоматически получены из таблицы user_accounts"
    exit 1
fi

print_info "Отправка видео на обработку..."
echo "Это может занять 30-90 секунд в зависимости от размера видео..."
echo ""

# Отправка запроса
START_TIME=$(date +%s)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/process-video" \
  -F "video=@$VIDEO_FILE" \
  -F "user_id=$USER_ID" \
  -F "title=$TITLE" \
  -F "description=$DESCRIPTION" \
  -F "language=$LANGUAGE" \
  -F "client_question=$CLIENT_QUESTION" \
  -F "site_url=$SITE_URL" \
  -F "utm=$UTM")

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Разделение ответа и HTTP кода
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "Время обработки: ${DURATION}s"
echo ""

# Проверка результата
if [ "$HTTP_CODE" = "200" ]; then
    print_info "✅ Видео успешно обработано!"
    echo ""
    echo "Ответ сервера:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    echo ""
    
    # Извлечение данных
    if command -v jq &> /dev/null; then
        CREATIVE_ID=$(echo "$BODY" | jq -r '.data.creative_id' 2>/dev/null)
        FB_VIDEO_ID=$(echo "$BODY" | jq -r '.data.fb_video_id' 2>/dev/null)
        WHATSAPP_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_whatsapp' 2>/dev/null)
        INSTAGRAM_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_instagram_traffic' 2>/dev/null)
        SITE_LEADS_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_site_leads' 2>/dev/null)
        TRANSCRIPTION=$(echo "$BODY" | jq -r '.data.transcription.text' 2>/dev/null)
        
        print_info "📊 Созданные ресурсы:"
        echo "  📝 Creative ID: $CREATIVE_ID"
        echo "  🎬 FB Video ID: $FB_VIDEO_ID"
        echo "  💬 WhatsApp Creative: $WHATSAPP_ID"
        echo "  📸 Instagram Creative: $INSTAGRAM_ID"
        echo "  🌐 Site Leads Creative: $SITE_LEADS_ID"
        echo ""
        
        if [ "$TRANSCRIPTION" != "null" ] && [ -n "$TRANSCRIPTION" ]; then
            print_info "📝 Транскрипция:"
            echo "  \"$TRANSCRIPTION\""
            echo ""
        fi
        
        print_info "🔗 Ссылки для проверки:"
        echo "  Facebook Ads Manager: https://business.facebook.com/adsmanager/manage/adaccounts"
        echo "  Supabase: https://supabase.com/dashboard"
    fi
    
    print_info "✅ Тест завершен успешно!"
    exit 0
    
else
    print_error "❌ Ошибка при обработке видео (HTTP $HTTP_CODE)"
    echo ""
    echo "Ответ сервера:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    exit 1
fi
