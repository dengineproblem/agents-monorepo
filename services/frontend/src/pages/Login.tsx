import { toastT } from '@/utils/toastUtils';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@/i18n/LanguageContext';
import { APP_REVIEW_MODE } from '@/config/appReview';

const USERNAME_REQUIRED_MESSAGE = APP_REVIEW_MODE ? 'Username is required' : 'Логин обязателен';
const PASSWORD_REQUIRED_MESSAGE = APP_REVIEW_MODE ? 'Password is required' : 'Пароль обязателен';

const loginSchema = z.object({
  username: z.string().min(1, USERNAME_REQUIRED_MESSAGE),
  password: z.string().min(1, PASSWORD_REQUIRED_MESSAGE),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();
  
  // Проверяем, авторизован ли пользователь уже
  useEffect(() => {
    const checkUser = () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          // Логин разрешен даже без Facebook токена
          if (parsedUser && parsedUser.username) {

            navigate('/', { replace: true });
          }
        } catch (error) {

          localStorage.removeItem('user');
        }
      }
    };
    
    checkUser();
  }, [navigate]);
  
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      setIsLoading(true);


      // Проверка пустых полей
      if (!data.username.trim() || !data.password.trim()) {

        toastT.error('emptyCredentials');
        setIsLoading(false);
        return;
      }

      // Запрашиваем пользователя из Supabase
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('username', data.username)
        .eq('password', data.password)
        .maybeSingle();

      if (error) {

        toastT.error('loginError');
        setIsLoading(false);
        return;
      }
      
      if (!user) {

        toastT.error('invalidCredentials');
        setIsLoading(false);
        return;
      }
      
      // Facebook данные теперь опциональны - подключаются в Profile

      });
      
      // Создаем данные сессии (Facebook данные опциональны)
      const sessionUser = {
        id: user.id,
        username: user.username,
        ad_account_id: user.ad_account_id || '',
        page_id: user.page_id || '',
        access_token: user.access_token || '',
        prompt1: user.prompt1 || null,
        is_tech_admin: user.is_tech_admin || false
      };
      
      // Подробно логируем данные, сохраняемые в localStorage

      // Сохраняем данные в localStorage
      localStorage.setItem('user', JSON.stringify(sessionUser));

      toastT.success('loggedIn');

      // Триггерим загрузку данных мультиаккаунта в AppContext
      window.dispatchEvent(new CustomEvent('reloadAdAccounts'));

      // Перенаправляем на главную страницу

      setTimeout(() => navigate('/', { replace: true }), 100);
      
    } catch (error) {

      toastT.error('loginError');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">{t('auth.loginTitle')}</h1>
          <p className="text-muted-foreground">{t('auth.loginSubtitle')}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.usernameLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('auth.usernamePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.passwordLabel')}</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder={t('auth.passwordPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('auth.loginButtonLoading') : t('auth.loginButton')}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
};

export default Login;
