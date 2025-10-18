import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const loginSchema = z.object({
  username: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  
  // Проверяем, авторизован ли пользователь уже
  useEffect(() => {
    const checkUser = () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          // Логин разрешен даже без Facebook токена
          if (parsedUser && parsedUser.username) {
            console.log('Пользователь уже авторизован, перенаправляем на главную', {
              username: parsedUser.username,
              hasToken: !!parsedUser.access_token,
              hasAdAccountId: !!parsedUser.ad_account_id,
              hasPageId: !!parsedUser.page_id
            });
            navigate('/', { replace: true });
          }
        } catch (error) {
          console.error('Ошибка при проверке сохраненного пользователя:', error);
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
      console.log('========== ПОПЫТКА ВХОДА ==========');
      console.log('Вход с именем пользователя:', data.username);
      
      // Проверка пустых полей
      if (!data.username.trim() || !data.password.trim()) {
        console.error('Пустой логин или пароль');
        toast.error('Логин и пароль не могут быть пустыми');
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
        
      console.log('Результат запроса к Supabase:', { 
        userFound: !!user,
        error: error 
      });
      
      if (error) {
        console.error('Ошибка запроса к базе данных:', error);
        toast.error('Ошибка при проверке учетных данных');
        setIsLoading(false);
        return;
      }
      
      if (!user) {
        console.error('Неверные учетные данные');
        toast.error('Неверный логин или пароль');
        setIsLoading(false);
        return;
      }
      
      // Проверка наличия необходимых данных для Facebook API
      if (!user.access_token || !user.ad_account_id || !user.page_id) {
        console.error('В учетной записи отсутствуют данные для Facebook API:', {
          hasToken: !!user.access_token,
          hasAdAccountId: !!user.ad_account_id,
          hasPageId: !!user.page_id
        });
        toast.error('В профиле пользователя отсутствуют необходимые данные для API');
        setIsLoading(false);
        return;
      }
      
      console.log('Аутентификация пользователя успешна!');
      
      // Создаем данные сессии
      const sessionUser = {
        id: user.id,
        username: user.username,
        ad_account_id: user.ad_account_id,
        page_id: user.page_id,
        access_token: user.access_token
      };
      
      // Подробно логируем данные, сохраняемые в localStorage
      console.log('Сохраняем данные пользователя в localStorage:', {
        id: sessionUser.id,
        username: sessionUser.username,
        ad_account_id: sessionUser.ad_account_id,
        page_id: sessionUser.page_id,
        access_token_length: sessionUser.access_token.length
      });
      
      // Сохраняем данные в localStorage
      localStorage.setItem('user', JSON.stringify(sessionUser));
      console.log('Данные пользователя сохранены в localStorage');
      
      toast.success('Вы успешно вошли в систему');
      
      // Перенаправляем на главную страницу
      console.log('Перенаправляем на главную страницу...');
      setTimeout(() => navigate('/', { replace: true }), 100);
      
    } catch (error) {
      console.error('Ошибка при входе:', error);
      toast.error('Произошла ошибка при входе');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Meta Ads Monitor</h1>
          <p className="text-muted-foreground">Войдите для доступа к панели управления</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Логин</FormLabel>
                  <FormControl>
                    <Input placeholder="Введите логин" {...field} />
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
                  <FormLabel>Пароль</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Введите пароль" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Вход...' : 'Войти'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
};

export default Login;
