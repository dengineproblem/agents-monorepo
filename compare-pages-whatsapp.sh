#!/bin/bash

TOKEN="EAAYNZCXReLZAoBO4XqBAkBBCaQTt36IphOKlbZBYFB0nCJOeutwZCaiWKZAbZBnj8tFUx7nXSaOZBy4YGdLxBbH1kqzHiTAZBTeauWOZCZB8FvoOMxmFwNcgoe6GYfjzATmKqDYLyzVjzhvnwTCSWF0FUjOoAQjTL40wc6hiwojsALaz7ZAkbdunVGkHQOt"

echo "=========================================="
echo "СРАВНЕНИЕ СТРАНИЦ"
echo "=========================================="
echo ""

echo "❌ ПРОБЛЕМНАЯ СТРАНИЦА (Select Phuket):"
echo "Page ID: 734116649781310"
echo "---"
curl -s "https://graph.facebook.com/v20.0/734116649781310?fields=id,name,whatsapp_number&access_token=${TOKEN}" | jq '.'
echo ""

echo "✅ РАБОТАЮЩАЯ СТРАНИЦА (AI-таргетолог):"
echo "Page ID: 114323838439928"
echo "---"
curl -s "https://graph.facebook.com/v20.0/114323838439928?fields=id,name,whatsapp_number&access_token=${TOKEN}" | jq '.'
echo ""

echo "=========================================="
echo "КЛЮЧЕВОЕ ОТЛИЧИЕ:"
echo "Если у работающей страницы ЕСТЬ поле whatsapp_number,"
echo "а у проблемной НЕТ - это и есть причина ошибки!"
echo "=========================================="
