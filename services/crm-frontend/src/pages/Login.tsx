import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const loginSchema = z.object({
  username: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { login: authLogin, isAuthenticated, isConsultant, user } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      // Проверить сохраненный returnUrl
      const returnUrl = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');

      if (returnUrl) {
        // Если был сохранен URL - перенаправляем туда
        navigate(returnUrl, { replace: true });
      } else if (isConsultant && user?.consultantId) {
        // Перенаправляем консультантов на их персональную страницу
        navigate(`/c/${user.consultantId}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [isAuthenticated, isConsultant, user, navigate]);

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

      if (!data.username.trim() || !data.password.trim()) {
        toast({
          title: 'Ошибка',
          description: 'Заполните все поля',
          variant: 'destructive',
        });
        return;
      }

      const result = await authLogin(data.username, data.password);

      if (!result.success) {
        toast({
          title: 'Ошибка',
          description: result.error || 'Неверный логин или пароль',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Успешно',
        description: 'Вы вошли в систему',
      });

      // Редирект происходит в useEffect выше

    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Ошибка при входе',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Вход в CRM</h1>
          <p className="text-muted-foreground">Введите данные для входа</p>
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
