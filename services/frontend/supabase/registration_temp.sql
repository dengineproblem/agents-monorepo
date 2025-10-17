create table registration_temp (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique, -- ключ для связи Telegram/фронт/n8n
  telegram_id text,
  username text,
  password_hash text,
  fb_access_token text,
  ad_accounts jsonb, -- массив кабинетов
  selected_ad_account_id text,
  page_id text,
  instagram_id text,
  registration_stage text, -- этап регистрации (например: 'brief', 'fb_auth', 'ad_account_select', 'done')
  prompt1 text,
  prompt2 text,
  prompt3 text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Индекс для быстрого поиска по registration_id
create index idx_registration_temp_registration_id on registration_temp(registration_id); 