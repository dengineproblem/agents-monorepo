-- Миграция: Создание таблицы для хранения ответов на бриф AI-таргетолог
-- Дата: 2025-11-21
-- Описание: Таблица хранит все ответы пользователя на вопросы брифинга для генерации prompt1

CREATE TABLE IF NOT EXISTS user_briefing_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    
    -- Основная информация о бизнесе
    business_name TEXT NOT NULL,
    business_niche TEXT NOT NULL,
    
    -- Онлайн-присутствие
    instagram_url TEXT,
    website_url TEXT,
    
    -- Целевая аудитория
    target_audience TEXT, -- Описание ЦА
    geography TEXT, -- География работы
    
    -- О продукте/услугах
    main_services TEXT, -- Основные услуги/продукты
    competitive_advantages TEXT, -- Конкурентные преимущества
    price_segment TEXT, -- эконом/средний/премиум
    
    -- Метаданные
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraint: один бриф на пользователя (можно обновлять)
    UNIQUE(user_id)
);

-- Индексы
CREATE INDEX idx_user_briefing_responses_user_id ON user_briefing_responses(user_id);
CREATE INDEX idx_user_briefing_responses_created_at ON user_briefing_responses(created_at DESC);

-- Комментарии
COMMENT ON TABLE user_briefing_responses IS 'Ответы пользователей на бриф AI-таргетолог для генерации персонализированных промптов';
COMMENT ON COLUMN user_briefing_responses.business_name IS 'Название бизнеса клиента';
COMMENT ON COLUMN user_briefing_responses.business_niche IS 'Ниша/сфера деятельности';
COMMENT ON COLUMN user_briefing_responses.instagram_url IS 'Ссылка на Instagram бизнеса';
COMMENT ON COLUMN user_briefing_responses.website_url IS 'Ссылка на сайт бизнеса';
COMMENT ON COLUMN user_briefing_responses.target_audience IS 'Описание целевой аудитории';
COMMENT ON COLUMN user_briefing_responses.geography IS 'География работы (город/регион)';
COMMENT ON COLUMN user_briefing_responses.main_services IS 'Основные услуги или продукты';
COMMENT ON COLUMN user_briefing_responses.competitive_advantages IS 'Конкурентные преимущества бизнеса';
COMMENT ON COLUMN user_briefing_responses.price_segment IS 'Ценовой сегмент: эконом, средний или премиум';

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_user_briefing_responses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для обновления updated_at
CREATE TRIGGER trigger_update_user_briefing_responses_updated_at
    BEFORE UPDATE ON user_briefing_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_user_briefing_responses_updated_at();

