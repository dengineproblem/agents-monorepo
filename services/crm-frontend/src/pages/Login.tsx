import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

const loginSchema = z.object({
  username: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser && parsedUser.username) {
          navigate('/', { replace: true });
        }
      } catch (error) {
        localStorage.removeItem('user');
      }
    }
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

      if (!data.username.trim() || !data.password.trim()) {
        toast({
          title: 'Ошибка',
          description: 'Заполните все поля',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('username', data.username)
        .eq('password', data.password)
        .maybeSingle();

      if (error) {
        toast({
          title: 'Ошибка',
          description: 'Ошибка при входе',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      if (!user) {
        toast({
          title: 'Ошибка',
          description: 'Неверный логин или пароль',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      const sessionUser = {
        id: user.id,
        username: user.username,
        is_tech_admin: user.is_tech_admin || false
      };

      localStorage.setItem('user', JSON.stringify(sessionUser));

      toast({
        title: 'Успешно',
        description: 'Вы вошли в систему',
      });

      navigate('/', { replace: true });

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
