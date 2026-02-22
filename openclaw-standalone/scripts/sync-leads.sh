#!/bin/bash
# Синхронизация WhatsApp лидов из SaaS → локальная БД
# Запуск: ./sync-leads.sh [slug]
# Без аргументов — синхронизация всех клиентов
# Можно добавить в cron: */30 * * * * /path/to/sync-leads.sh

set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5435}"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-openclaw_local}"

SLUG="${1:-}"
SYNC_INTERVAL="${SYNC_INTERVAL:-1 hour}"
LOCK_FILE="/tmp/sync-leads.lock"

export PGPASSWORD="$PG_PASSWORD"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# ─── Lock file (prevent parallel cron runs) ───────────────────────
if [ -f "$LOCK_FILE" ]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "$(ts) [WARN] Another sync is running (PID $lock_pid), exiting"
    exit 0
  fi
  echo "$(ts) [WARN] Stale lock file removed (PID $lock_pid not running)"
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ─── Escape function for psql dollar-quoting ──────────────────────
# Uses $tag$...$tag$ so content with single quotes, backslashes etc is safe
psql_escape() {
  local val="$1"
  if [ -z "$val" ]; then
    echo "NULL"
  else
    # Dollar-quoting: $q$value$q$ — safe against all special chars
    # except the literal string $q$ inside the value (extremely unlikely)
    echo "\$q\$${val}\$q\$"
  fi
}

sync_client() {
  local db_name="$1"
  local slug="${db_name#openclaw_}"

  # Получить SaaS credentials
  local saas_db saas_id
  saas_db=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$db_name" -t -A \
    -c "SELECT saas_db_url FROM config WHERE id = 1" 2>/dev/null || echo "")
  saas_id=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$db_name" -t -A \
    -c "SELECT saas_account_id FROM config WHERE id = 1" 2>/dev/null || echo "")

  if [ -z "$saas_db" ] || [ -z "$saas_id" ]; then
    echo "$(ts)   [$slug] SaaS not configured, skipping"
    return
  fi

  # Получить WhatsApp лиды из SaaS (dialog_analysis) за последний интервал
  local count=0
  count=$(psql "$saas_db" -t -A -c "
    SELECT COUNT(*) FROM dialog_analysis
    WHERE user_account_id = '$saas_id'
      AND last_message > NOW() - INTERVAL '$SYNC_INTERVAL'
  " 2>/dev/null || echo "0")

  if [ "$count" = "0" ]; then
    echo "$(ts)   [$slug] No new dialogs"
    return
  fi

  # Синхронизировать лиды — используем временный файл для безопасной вставки
  local tmp_file
  tmp_file=$(mktemp /tmp/sync-leads-XXXXXX.sql)
  trap 'rm -f "$tmp_file" "$LOCK_FILE"' EXIT

  local synced=0

  # Читаем данные из SaaS и генерируем безопасный SQL
  psql "$saas_db" -t -A -c "
    SELECT contact_phone, contact_name, direction_id::text, ctwa_clid, first_message
    FROM dialog_analysis
    WHERE user_account_id = '$saas_id'
      AND last_message > NOW() - INTERVAL '$SYNC_INTERVAL'
  " 2>/dev/null | while IFS='|' read -r phone name dir_id ctwa first_msg; do
    [ -z "$phone" ] && continue

    # Экранируем все поля через dollar-quoting (безопасно от SQL injection)
    local e_phone e_name e_ctwa e_first_msg
    e_phone=$(psql_escape "$phone")
    e_name=$(psql_escape "$name")
    e_ctwa=$(psql_escape "$ctwa")
    e_first_msg=$(psql_escape "$first_msg")

    # Для ctwa_clid: используем NULLIF чтобы пустые строки стали NULL
    local ctwa_expr
    if [ -z "$ctwa" ]; then
      ctwa_expr="NULL"
    else
      ctwa_expr="$e_ctwa"
    fi

    # Для created_at: если first_msg пустой, используем NOW()
    local created_expr
    if [ -z "$first_msg" ]; then
      created_expr="NOW()"
    else
      created_expr="$e_first_msg::timestamptz"
    fi

    cat >> "$tmp_file" <<EOSQL
INSERT INTO leads (phone, name, source_type, utm_source, chat_id, ctwa_clid, created_at)
VALUES ($e_phone, $e_name, 'whatsapp', 'whatsapp', $e_phone, $ctwa_expr, $created_expr)
ON CONFLICT DO NOTHING;
EOSQL
    synced=$((synced + 1))
  done

  # Считаем строки в SQL файле (каждый INSERT = 3 строки)
  if [ -s "$tmp_file" ]; then
    local insert_count
    insert_count=$(grep -c '^INSERT' "$tmp_file" 2>/dev/null || echo "0")

    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$db_name" -q -f "$tmp_file" 2>/dev/null
    echo "$(ts)   [$slug] Synced $insert_count leads (from $count dialogs)"
  else
    echo "$(ts)   [$slug] No valid leads to sync (from $count dialogs)"
  fi

  rm -f "$tmp_file"
}

echo "$(ts) === WhatsApp Leads Sync ==="
echo "$(ts) Interval: $SYNC_INTERVAL"

if [ -n "$SLUG" ]; then
  # Sync single client
  sync_client "openclaw_${SLUG}"
else
  # Sync all clients
  dbs=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -t -A \
    -c "SELECT datname FROM pg_database WHERE datname LIKE 'openclaw_%' AND datname != 'openclaw'" 2>/dev/null || echo "")

  if [ -z "$dbs" ]; then
    echo "$(ts) No OpenClaw databases found"
    exit 0
  fi

  for db in $dbs; do
    sync_client "$db"
  done
fi

echo "$(ts) === Sync complete ==="
