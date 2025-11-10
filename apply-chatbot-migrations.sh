#!/bin/bash

# Load Supabase credentials from .env.agent
if [ -f ".env.agent" ]; then
  export $(grep -v '^#' .env.agent | xargs)
elif [ -f "/root/.env.agent" ]; then
  export $(grep -v '^#' /root/.env.agent | xargs)
else
  echo "Error: .env.agent file not found in current directory or /root/"
  exit 1
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE" ]; then
  echo "Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE not set in .env.agent"
  exit 1
fi

# Extract database host from Supabase URL
# Example: https://ikywuvtavpnjlrjtalqi.supabase.co → ikywuvtavpnjlrjtalqi
DB_HOST=$(echo $SUPABASE_URL | sed -e 's/^https:\/\///' -e 's/\.supabase\.co.*//')
DB_PORT=5432 # Default Supabase port
DB_USER="postgres" # Default Supabase user
DB_NAME="postgres" # Default Supabase database name

echo "=========================================="
echo "Applying Chatbot Migrations to Supabase"
echo "=========================================="
echo "Host: $DB_HOST.supabase.co"
echo "Port: $DB_PORT"
echo "User: $DB_USER"
echo "DB: $DB_NAME"
echo ""

# Apply 030_chatbot_fields.sql
echo "📄 Applying 030_chatbot_fields.sql..."
PGPASSWORD=$SUPABASE_SERVICE_ROLE psql -h ${DB_HOST}.supabase.co -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/030_chatbot_fields.sql

if [ $? -eq 0 ]; then
  echo "✅ 030_chatbot_fields.sql applied successfully."
else
  echo "❌ Error applying 030_chatbot_fields.sql. Exiting."
  exit 1
fi

echo ""

# Apply 031_chatbot_configurations.sql
echo "📄 Applying 031_chatbot_configurations.sql..."
PGPASSWORD=$SUPABASE_SERVICE_ROLE psql -h ${DB_HOST}.supabase.co -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/031_chatbot_configurations.sql

if [ $? -eq 0 ]; then
  echo "✅ 031_chatbot_configurations.sql applied successfully."
else
  echo "❌ Error applying 031_chatbot_configurations.sql. Exiting."
  exit 1
fi

echo ""
echo "=========================================="
echo "🎉 All chatbot migrations applied successfully!"
echo "=========================================="
