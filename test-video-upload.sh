#!/bin/bash

# Скрипт для тестирования API обработки видео
# Использование: ./test-video-upload.sh [путь_к_видео]

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для вывода цветного текста
print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Проверка параметров
VIDEO_FILE=${1:-"./test-video.mp4"}
API_URL=${API_URL:-"http://localhost:8080"}

print_info "Начало тестирования API обработки видео"
echo "API URL: $API_URL"
echo "Видео файл: $VIDEO_FILE"
echo ""

# Проверка наличия видео файла
if [ ! -f "$VIDEO_FILE" ]; then
    print_error "Видео файл не найден: $VIDEO_FILE"
    print_info "Использование: ./test-video-upload.sh [путь_к_видео]"
    exit 1
fi

# Проверка health endpoint
print_info "Проверка health endpoint..."
HEALTH_RESPONSE=$(curl -s "$API_URL/health")
if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
    print_info "✅ Сервис запущен и работает"
else
    print_error "Сервис не отвечает или работает некорректно"
    echo "Ответ: $HEALTH_RESPONSE"
    exit 1
fi

echo ""

# Параметры для тестирования (замените на реальные значения)
USER_ID=${USER_ID:-"123e4567-e89b-12d3-a456-426614174000"}
AD_ACCOUNT_ID=${AD_ACCOUNT_ID:-"act_123456789"}
PAGE_ID=${PAGE_ID:-"987654321"}
INSTAGRAM_ID=${INSTAGRAM_ID:-"17841400000000000"}
INSTAGRAM_USERNAME=${INSTAGRAM_USERNAME:-"testaccount"}
PAGE_ACCESS_TOKEN=${PAGE_ACCESS_TOKEN:-"EAAxxxxxxxxxxxxx"}
TITLE=${TITLE:-"Test Video $(date +%Y%m%d_%H%M%S)"}
DESCRIPTION=${DESCRIPTION:-"Тестовое описание для проверки API обработки видео"}
LANGUAGE=${LANGUAGE:-"ru"}
CLIENT_QUESTION=${CLIENT_QUESTION:-"Здравствуйте! Интересует ваше предложение."}
SITE_URL=${SITE_URL:-"https://example.com"}
UTM=${UTM:-"utm_source=test&utm_medium=video&utm_campaign=api_test"}

print_warning "Используются тестовые значения параметров"
print_warning "Установите переменные окружения для использования реальных значений:"
echo "  - USER_ID"
echo "  - AD_ACCOUNT_ID"
echo "  - PAGE_ID"
echo "  - INSTAGRAM_ID"
echo "  - INSTAGRAM_USERNAME"
echo "  - PAGE_ACCESS_TOKEN"
echo ""

# Проверка обязательных параметров
if [ "$PAGE_ACCESS_TOKEN" = "EAAxxxxxxxxxxxxx" ]; then
    print_error "Необходимо установить реальный PAGE_ACCESS_TOKEN!"
    echo "Экспортируйте переменную:"
    echo "  export PAGE_ACCESS_TOKEN='ваш_токен'"
    exit 1
fi

print_info "Отправка видео на обработку..."
echo ""

# Отправка запроса
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/process-video" \
  -F "video=@$VIDEO_FILE" \
  -F "user_id=$USER_ID" \
  -F "ad_account_id=$AD_ACCOUNT_ID" \
  -F "page_id=$PAGE_ID" \
  -F "instagram_id=$INSTAGRAM_ID" \
  -F "instagram_username=$INSTAGRAM_USERNAME" \
  -F "page_access_token=$PAGE_ACCESS_TOKEN" \
  -F "title=$TITLE" \
  -F "description=$DESCRIPTION" \
  -F "language=$LANGUAGE" \
  -F "client_question=$CLIENT_QUESTION" \
  -F "site_url=$SITE_URL" \
  -F "utm=$UTM")

# Разделение ответа и HTTP кода
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo ""

# Проверка результата
if [ "$HTTP_CODE" = "200" ]; then
    print_info "✅ Видео успешно обработано!"
    echo ""
    echo "Ответ сервера:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    echo ""
    
    # Извлечение ID креативов
    if command -v jq &> /dev/null; then
        CREATIVE_ID=$(echo "$BODY" | jq -r '.data.creative_id' 2>/dev/null)
        FB_VIDEO_ID=$(echo "$BODY" | jq -r '.data.fb_video_id' 2>/dev/null)
        WHATSAPP_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_whatsapp' 2>/dev/null)
        INSTAGRAM_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_instagram_traffic' 2>/dev/null)
        SITE_LEADS_ID=$(echo "$BODY" | jq -r '.data.fb_creative_id_site_leads' 2>/dev/null)
        
        print_info "Созданные ресурсы:"
        echo "  📝 Creative ID: $CREATIVE_ID"
        echo "  🎬 FB Video ID: $FB_VIDEO_ID"
        echo "  💬 WhatsApp Creative ID: $WHATSAPP_ID"
        echo "  📸 Instagram Creative ID: $INSTAGRAM_ID"
        echo "  🌐 Site Leads Creative ID: $SITE_LEADS_ID"
        echo ""
        
        TRANSCRIPTION=$(echo "$BODY" | jq -r '.data.transcription.text' 2>/dev/null)
        if [ "$TRANSCRIPTION" != "null" ] && [ -n "$TRANSCRIPTION" ]; then
            print_info "Транскрипция:"
            echo "  \"$TRANSCRIPTION\""
            echo ""
        fi
    fi
    
    print_info "Проверьте Facebook Ads Manager для просмотра креативов:"
    echo "  https://business.facebook.com/adsmanager/manage/adaccounts"
    
else
    print_error "Ошибка при обработке видео (HTTP $HTTP_CODE)"
    echo ""
    echo "Ответ сервера:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
    exit 1
fi

echo ""
print_info "Тест завершен!"
