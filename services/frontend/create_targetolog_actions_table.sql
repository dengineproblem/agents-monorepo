-- Упрощенная таблица для журнала действий таргетолога
CREATE TABLE IF NOT EXISTS targetolog_actions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  username VARCHAR(255), -- Для удобства таргетолога
  action_text TEXT NOT NULL, -- Произвольное описание действий таргетолога
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255), -- Имя/ID таргетолога который выполнил действие
  
  -- Ограничения
  CONSTRAINT targetolog_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_targetolog_actions_user_id ON targetolog_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_targetolog_actions_created_at ON targetolog_actions(created_at DESC);

-- Комментарии к таблице
COMMENT ON TABLE targetolog_actions IS 'Простой журнал действий таргетолога для каждого клиента';
COMMENT ON COLUMN targetolog_actions.user_id IS 'ID пользователя из user_accounts';
COMMENT ON COLUMN targetolog_actions.username IS 'Имя пользователя для удобства таргетолога';
COMMENT ON COLUMN targetolog_actions.action_text IS 'Произвольное текстовое описание действий таргетолога';
COMMENT ON COLUMN targetolog_actions.created_by IS 'Таргетолог который выполнил действие';