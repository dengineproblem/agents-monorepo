-- OpenClaw Standalone: PostgreSQL init
-- Этот файл выполняется один раз при создании контейнера.
-- Таблицы создаются per-client через scripts/create-client.sh + schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
