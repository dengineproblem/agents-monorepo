#!/bin/bash

# Тестовые API вызовы для Facebook App Review
# Замените YOUR_ACCESS_TOKEN и YOUR_AD_ACCOUNT_ID на реальные значения

ACCESS_TOKEN="YOUR_ACCESS_TOKEN"
AD_ACCOUNT_ID="YOUR_AD_ACCOUNT_ID"

echo "=========================================="
echo "Facebook App Review - Тестовые API вызовы"
echo "=========================================="
echo ""

echo "1️⃣  Тестируем pages_show_list и pages_manage_ads..."
echo "GET /me/accounts"
curl -X GET "https://graph.facebook.com/v21.0/me/accounts?access_token=${ACCESS_TOKEN}"
echo -e "\n\n"

echo "2️⃣  Тестируем business_management..."
echo "GET /me/businesses"
curl -X GET "https://graph.facebook.com/v21.0/me/businesses?access_token=${ACCESS_TOKEN}"
echo -e "\n\n"

echo "3️⃣  Тестируем ads_read..."
echo "GET /act_${AD_ACCOUNT_ID}/campaigns"
curl -X GET "https://graph.facebook.com/v21.0/act_${AD_ACCOUNT_ID}/campaigns?fields=id,name,status&access_token=${ACCESS_TOKEN}"
echo -e "\n\n"

echo "4️⃣  Тестируем ads_management..."
echo "GET /act_${AD_ACCOUNT_ID}/adsets"
curl -X GET "https://graph.facebook.com/v21.0/act_${AD_ACCOUNT_ID}/adsets?fields=id,name,status&access_token=${ACCESS_TOKEN}"
echo -e "\n\n"

echo "✅ Все тестовые вызовы выполнены!"
echo "⏰ Подождите до 24 часов, пока Facebook обработает данные."

