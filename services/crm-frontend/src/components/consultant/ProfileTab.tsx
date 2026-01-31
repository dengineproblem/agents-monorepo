import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { consultantApi } from '@/services/consultantApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export function ProfileTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Данные профиля
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    email: '',
    specialization: '',
  });

  // Загрузка профиля при монтировании
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        const data = await consultantApi.getProfile(consultantId);
        setProfile({
          name: data.name || '',
          phone: data.phone || '',
          email: data.email || '',
          specialization: data.specialization || '',
        });
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast({
          title: 'Ошибка',
          description: 'Не удалось загрузить данные профиля',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    if (consultantId) {
      loadProfile();
    }
  }, [consultantId, toast]);

  // Данные для смены пароля
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: '',
  });

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      await consultantApi.updateProfile(profile);

      toast({
        title: 'Успешно',
        description: 'Профиль обновлен',
      });
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось обновить профиль',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwords.new !== passwords.confirm) {
      toast({
        title: 'Ошибка',
        description: 'Пароли не совпадают',
        variant: 'destructive',
      });
      return;
    }

    if (passwords.new.length < 4) {
      toast({
        title: 'Ошибка',
        description: 'Пароль должен содержать минимум 4 символа',
        variant: 'destructive',
      });
      return;
    }

    try {
      setChangingPassword(true);
      await consultantApi.changePassword(passwords.current, passwords.new);

      toast({
        title: 'Успешно',
        description: 'Пароль изменен',
      });

      // Очистить поля
      setPasswords({ current: '', new: '', confirm: '' });
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось изменить пароль',
        variant: 'destructive',
      });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Основная информация */}
      <Card>
        <CardHeader>
          <CardTitle>Основная информация</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Имя</Label>
            <Input
              id="name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Ваше имя"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Телефон</Label>
            <Input
              id="phone"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+7 (999) 123-45-67"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="email@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="specialization">Специализация</Label>
            <Input
              id="specialization"
              value={profile.specialization}
              onChange={(e) => setProfile({ ...profile, specialization: e.target.value })}
              placeholder="Ваша специализация"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSaveProfile}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </CardContent>
      </Card>

      {/* Смена пароля */}
      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Текущий пароль</Label>
            <Input
              id="current-password"
              type="password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              placeholder="Введите текущий пароль"
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="new-password">Новый пароль</Label>
            <Input
              id="new-password"
              type="password"
              value={passwords.new}
              onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
              placeholder="Введите новый пароль"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Подтверждение пароля</Label>
            <Input
              id="confirm-password"
              type="password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              placeholder="Повторите новый пароль"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleChangePassword}
            disabled={changingPassword || !passwords.current || !passwords.new || !passwords.confirm}
          >
            {changingPassword ? 'Изменение...' : 'Изменить пароль'}
          </Button>

          <p className="text-xs text-muted-foreground">
            После смены пароля вам потребуется войти заново
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
