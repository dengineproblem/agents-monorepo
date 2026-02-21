CREATE TABLE config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Facebook
  fb_access_token TEXT,
  fb_page_id TEXT,
  fb_page_access_token TEXT,
  fb_ad_account_id TEXT,
  fb_instagram_id TEXT,
  fb_app_secret TEXT,
  fb_webhook_verify_token TEXT DEFAULT 'openclaw_leadgen_2026',

  -- Telegram
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,

  -- Settings
  timezone TEXT DEFAULT 'Asia/Almaty',
  default_target_cpl_cents INTEGER DEFAULT 300,
  currency TEXT DEFAULT 'KZT',
  adset_creation_cutoff_hour INTEGER DEFAULT 18,
  min_budget_cents INTEGER DEFAULT 300,
  max_budget_cents INTEGER DEFAULT 10000,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO config (id) VALUES (1);
