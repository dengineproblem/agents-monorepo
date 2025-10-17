import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Phone, Clock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

const CallbackRequest: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [topic, setTopic] = useState('');

  const timeSlots = [
    { value: '9-11', label: '9:00 - 11:00' },
    { value: '11-13', label: '11:00 - 13:00' },
    { value: '13-15', label: '13:00 - 15:00' },
    { value: '15-17', label: '15:00 - 17:00' },
    { value: '17-19', label: '17:00 - 19:00' },
    { value: '19-21', label: '19:00 - 21:00' }
  ];

  const topics = [
    { value: 'optimization', label: 'Оптимизация кампаний' },
    { value: 'budget', label: 'Увеличение бюджета' },
    { value: 'new_campaigns', label: 'Новые кампании' },
    { value: 'analytics', label: 'Анализ результатов' },
    { value: 'strategy', label: 'Стратегия развития' },
    { value: 'other', label: 'Другое' }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phone || !name || !preferredTime || !topic) {
      toast.error('Заполните все обязательные поля');
      return;
    }

    setIsSubmitting(true);

    try {
      // Здесь будет отправка данных на сервер
      // Пока что имитируем отправку
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      toast.success('Заявка успешно отправлена! Специалист свяжется с вами в указанное время.');
      
      // Очищаем форму
      setPhone('');
      setName('');
      setPreferredTime('');
      setTopic('');
      setIsOpen(false);
      
    } catch (error) {
      toast.error('Ошибка при отправке заявки. Попробуйте еще раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Phone className="mr-2 h-4 w-4" />
          Заказать звонок
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Заказать звонок специалиста
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Имя *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите ваше имя"
              className="mt-1"
              required
            />
          </div>

          <div>
            <Label htmlFor="phone">Телефон *</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (___) ___-__-__"
              className="mt-1"
              required
            />
          </div>

          <div>
            <Label htmlFor="topic">Тема обращения *</Label>
            <Select value={topic} onValueChange={setTopic} required>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Выберите тему" />
              </SelectTrigger>
              <SelectContent>
                {topics.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="time">Удобное время для звонка *</Label>
            <Select value={preferredTime} onValueChange={setPreferredTime} required>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Выберите время" />
              </SelectTrigger>
              <SelectContent>
                {timeSlots.map((slot) => (
                  <SelectItem key={slot.value} value={slot.value}>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {slot.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-gradient-to-r from-gray-50 to-slate-50 border border-gray-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-gray-600 mt-0.5" />
              <div className="text-sm text-gray-700">
                <p className="font-medium">Специалист свяжется с вами:</p>
                <ul className="mt-1 text-xs list-disc list-inside">
                  <li>В указанное время в течение рабочего дня</li>
                  <li>Для консультации по оптимизации кампаний</li>
                  <li>Звонок бесплатный, длительность 15-30 минут</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting || !phone || !name || !preferredTime || !topic}
            >
              {isSubmitting ? 'Отправляется...' : 'Заказать звонок'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CallbackRequest;