/**
 * Translations for App Review mode
 * 
 * English (en) - default for App Review
 * Russian (ru) - default for Production
 */

export const translations = {
  en: {
    menu: {
      dashboard: 'Dashboard',
      campaigns: 'Campaigns',
      creatives: 'Creatives',
      directions: 'Directions',
      profile: 'Profile',
      settings: 'Settings',
      roi: 'ROI Analytics',
      consultations: 'Consultations',
    },
    action: {
      uploadVideo: 'Upload Video',
      uploadImage: 'Upload Image',
      connect: 'Connect',
      disconnect: 'Disconnect',
      save: 'Save',
      cancel: 'Cancel',
      pause: 'Pause',
      resume: 'Resume',
      create: 'Create',
      edit: 'Edit',
      delete: 'Delete',
    },
    msg: {
      confirmPause: 'Are you sure you want to pause this campaign?',
      confirmResume: 'Are you sure you want to resume this campaign?',
      confirmCreate: 'Are you sure you want to create this campaign?',
      confirmDelete: 'Are you sure you want to delete this item?',
      success: 'Success',
      error: 'Error',
      loading: 'Loading...',
    },
    platform: {
      facebook: 'Facebook Ads',
      tiktok: 'TikTok Ads',
      instagram: 'Instagram',
    },
  },
  ru: {
    menu: {
      dashboard: 'Дашборд',
      campaigns: 'Кампании',
      creatives: 'Креативы',
      directions: 'Направления',
      profile: 'Профиль',
      settings: 'Настройки',
      roi: 'ROI Аналитика',
      consultations: 'Консультации',
    },
    action: {
      uploadVideo: 'Загрузить видео',
      uploadImage: 'Загрузить изображение',
      connect: 'Подключить',
      disconnect: 'Отключить',
      save: 'Сохранить',
      cancel: 'Отмена',
      pause: 'Приостановить',
      resume: 'Возобновить',
      create: 'Создать',
      edit: 'Редактировать',
      delete: 'Удалить',
    },
    msg: {
      confirmPause: 'Вы уверены, что хотите приостановить эту кампанию?',
      confirmResume: 'Вы уверены, что хотите возобновить эту кампанию?',
      confirmCreate: 'Вы уверены, что хотите создать эту кампанию?',
      confirmDelete: 'Вы уверены, что хотите удалить этот элемент?',
      success: 'Успешно',
      error: 'Ошибка',
      loading: 'Загрузка...',
    },
    platform: {
      facebook: 'Facebook Реклама',
      tiktok: 'TikTok Реклама',
      instagram: 'Instagram',
    },
  },
};

export type Language = 'en' | 'ru';

