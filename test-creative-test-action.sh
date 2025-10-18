#!/bin/bash

echo "🔍 Поиск креативов в user_creatives..."

# Получаем креативы из Supabase
SUPABASE_URL="${SUPABASE_URL:-https://eftvzhbjvobqklbroszv.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE}"

# Ищем готовые креативы с WhatsApp creative_id
curl -s "${SUPABASE_URL}/rest/v1/user_creatives?status=eq.ready&fb_creative_id_whatsapp=not.is.null&select=id,user_id,title,fb_creative_id_whatsapp,created_at&limit=5" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'

