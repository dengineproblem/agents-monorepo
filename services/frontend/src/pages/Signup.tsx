import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FB_CLIENT_ID = '690472653668355';
const FB_REDIRECT_URI = 'https://ad-dash-telegram-bot.lovable.app/'; // основной redirect_uri
const FB_SCOPE = 'ads_read,ads_management,business_management,pages_show_list,instagram_basic';
const FB_AUTH_URL = `https://www.facebook.com/v15.0/dialog/oauth?client_id=${FB_CLIENT_ID}&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&scope=${FB_SCOPE}&response_type=code`;
const WEBHOOK_URL = 'https://n8n.performanteaiagency.com/webhook/token';

const Signup: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Получаем telegram_id и code из query
  const params = new URLSearchParams(window.location.search);
  const telegram_id = params.get('telegram_id');
  const code = params.get('code');

  // После возврата с Facebook OAuth — отправляем code, telegram_id, username, password, phone на n8n
  useEffect(() => {
    if (!code || !telegram_id) return;
    // Получаем данные из localStorage
    const username = localStorage.getItem('signup_username') || '';
    const password = localStorage.getItem('signup_password') || '';
    const phone = localStorage.getItem('signup_phone') || '';
    const sendToWebhook = async () => {
      setLoading(true);
      setError(null);
      // Проверка на пустые поля
      if (!username || !password || !phone) {
        setError('Ошибка: не все данные заполнены. username: ' + username + ', password: ' + password + ', phone: ' + phone);
        setLoading(false);
        return;
      }
      // Логируем отправляемые данные для отладки
      console.log('Отправка на n8n:', {
        code,
        telegram_id,
        username,
        password,
        phone
      });
      try {
        await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            telegram_id,
            username,
            password,
            phone
          })
        });
        setSuccess(true);
        // Очищаем localStorage после успешной отправки
        localStorage.removeItem('signup_username');
        localStorage.removeItem('signup_password');
        localStorage.removeItem('signup_phone');
      } catch (err) {
        setError('Ошибка при отправке данных на n8n: ' + (err instanceof Error ? err.message : String(err)));
      }
      setLoading(false);
    };
    sendToWebhook();
  }, [code, telegram_id]);

  // Сохраняем значения в localStorage при каждом изменении поля
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    localStorage.setItem('signup_username', e.target.value);
  };
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    localStorage.setItem('signup_password', e.target.value);
  };
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
    localStorage.setItem('signup_phone', e.target.value);
  };

  // Сохраняем логин/пароль/телефон в localStorage при вводе и перед OAuth
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password || !phone) {
      setError('Заполните все поля: логин, пароль и телефон');
      return;
    }
    if (!telegram_id) {
      setError('telegram_id не найден');
      return;
    }
    setLoading(true);
    // Сохраняем данные в localStorage
    localStorage.setItem('signup_username', username);
    localStorage.setItem('signup_password', password);
    localStorage.setItem('signup_phone', phone);
    setLoading(false);
    // Переход на Facebook OAuth
    window.location.href = FB_AUTH_URL;
  };

  if (!telegram_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card p-6 rounded shadow-md w-full max-w-sm flex flex-col gap-4 items-center">
          <h2 className="text-xl font-semibold mb-2">Ошибка</h2>
          <div>telegram_id не найден. Перейдите по ссылке из Telegram-бота.</div>
        </div>
      </div>
    );
  }

  // Если есть code — показываем прогресс отправки на n8n
  if (code) {
    // Для отладки: выводим значения из localStorage
    const debugUsername = localStorage.getItem('signup_username') || '';
    const debugPassword = localStorage.getItem('signup_password') || '';
    const debugPhone = localStorage.getItem('signup_phone') || '';
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card p-6 rounded shadow-md w-full max-w-sm flex flex-col gap-4 items-center">
          <h2 className="text-xl font-semibold mb-2">Завершение регистрации</h2>
          {loading && <div>Отправка данных...</div>}
          {success && <div className="text-green-600 text-sm">Данные успешно отправлены, регистрация продолжается...</div>}
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="text-xs text-gray-500 mt-2">DEBUG:<br/>username: {debugUsername}<br/>password: {debugPassword}<br/>phone: {debugPhone}</div>
        </div>
      </div>
    );
  }

  // Страница регистрации временно неактивна
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card p-6 rounded shadow-md w-full max-w-sm flex flex-col gap-4 items-center">
        <h2 className="text-xl font-semibold mb-2">Регистрация недоступна</h2>
        <div>Регистрация временно отключена. Пожалуйста, обратитесь к администратору или попробуйте позже.</div>
      </div>
    </div>
  );
};

export default Signup; 