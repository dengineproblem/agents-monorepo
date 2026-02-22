#!/bin/bash
# Создание БД для Evolution API (WhatsApp)
# Docker postgres выполняет *.sh из docker-entrypoint-initdb.d при первом запуске

set -e

echo "Creating Evolution API database if not exists..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE evolution'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
EOSQL

echo "Evolution API database ready."
