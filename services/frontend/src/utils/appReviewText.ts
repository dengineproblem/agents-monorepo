import { APP_REVIEW_MODE } from '../config/appReview';

export const appReviewText = <T,>(english: T, fallback: T): T => (
  APP_REVIEW_MODE ? english : fallback
);
