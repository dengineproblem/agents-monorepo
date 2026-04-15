-- Добавляем поля плейсментов и площадок в таблицу default_ad_settings
-- publisher_platforms: площадки (facebook, instagram). NULL = Advantage+ Placements
-- facebook_placements: позиции Facebook (feed, story, reels, marketplace, search, instream_video)
-- instagram_placements: позиции Instagram (stream, story, reels, explore)
-- NULL или пустой массив в любом поле = Facebook выбирает автоматически

ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS publisher_platforms TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS facebook_placements TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS instagram_placements TEXT[] DEFAULT NULL;

COMMENT ON COLUMN default_ad_settings.publisher_platforms IS
  'Площадки: facebook, instagram. NULL = Advantage+ Placements (все площадки, Facebook выбирает авто).';

COMMENT ON COLUMN default_ad_settings.facebook_placements IS
  'Позиции Facebook: feed, story, reels, marketplace, search, instream_video. NULL = все позиции Facebook.';

COMMENT ON COLUMN default_ad_settings.instagram_placements IS
  'Позиции Instagram: stream (Лента), story (Истории), reels (Reels), explore (Explore). NULL = все позиции Instagram.';
