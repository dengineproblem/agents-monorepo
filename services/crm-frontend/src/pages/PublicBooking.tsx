import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, Phone, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const API_BASE_URL = import.meta.env.VITE_CRM_BACKEND_URL || '/api/crm';

interface Consultant {
  id: string;
  name: string;
  specialization?: string;
}

interface Service {
  id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  currency: string;
  color: string;
}

interface Slot {
  consultant_id: string;
  consultant_name: string;
  date: string;
  start_time: string;
  end_time: string;
}

interface BookingConfig {
  consultants: Consultant[];
  services: Service[];
  business: {
    company_name?: string;
    logo_url?: string;
  } | null;
  settings: {
    days_ahead: number;
    min_booking_notice_hours: number;
  };
}

type Step = 'select' | 'details' | 'success';

export function PublicBooking() {
  const { userAccountId } = useParams<{ userAccountId: string }>();

  const [step, setStep] = useState<Step>('select');
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Selected values
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Form values
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');

  // Calendar navigation - separate for each consultant
  const [viewDates, setViewDates] = useState<Record<string, Date>>({});
  const [selectedDates, setSelectedDates] = useState<Record<string, string>>({});

  // Load config and slots
  useEffect(() => {
    if (!userAccountId) return;

    const loadData = async () => {
      setIsLoading(true);
      try {
        // Load config
        const configResponse = await fetch(`${API_BASE_URL}/public/booking/${userAccountId}/config`);
        if (!configResponse.ok) throw new Error('Failed to load configuration');
        const configData = await configResponse.json();
        setConfig(configData);

        // Load slots for all consultants
        const slotsResponse = await fetch(`${API_BASE_URL}/public/booking/${userAccountId}/slots?days_ahead=14`);
        if (!slotsResponse.ok) throw new Error('Failed to load slots');
        const slotsData = await slotsResponse.json();
        setSlots(slotsData.slots || []);
      } catch (err) {
        setError('Не удалось загрузить форму записи');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [userAccountId]);

  const handleSubmit = async () => {
    if (!userAccountId || !selectedSlot || !clientName || !clientPhone) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/public/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_account_id: userAccountId,
          consultant_id: selectedSlot.consultant_id,
          service_id: config?.services[0]?.id, // Use first service or null
          client_name: clientName,
          client_phone: clientPhone,
          date: selectedSlot.date,
          start_time: selectedSlot.start_time,
          notes: notes || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка при записи');
      }

      setSuccessMessage(data.message);
      setStep('success');
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при записи');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Group slots by consultant
  const slotsByConsultant = slots.reduce((acc, slot) => {
    if (!acc[slot.consultant_id]) {
      acc[slot.consultant_id] = {
        name: slot.consultant_name,
        slots: []
      };
    }
    acc[slot.consultant_id].slots.push(slot);
    return acc;
  }, {} as Record<string, { name: string; slots: Slot[] }>);

  // Group slots by date within each consultant
  const groupSlotsByDate = (consultantSlots: Slot[]) => {
    return consultantSlots.reduce((acc, slot) => {
      if (!acc[slot.date]) {
        acc[slot.date] = [];
      }
      acc[slot.date].push(slot);
      return acc;
    }, {} as Record<string, Slot[]>);
  };

  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDate();
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return `${weekdays[date.getDay()]}, ${day} ${months[date.getMonth()]}`;
  };

  // Get dates for week view
  const getDatesInView = (viewDate: Date) => {
    const dates: Date[] = [];
    const start = new Date(viewDate);
    start.setDate(start.getDate() - start.getDay() + 1); // Start from Monday

    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const getViewDate = (consultantId: string) => {
    return viewDates[consultantId] || new Date();
  };

  const getSelectedDate = (consultantId: string) => {
    return selectedDates[consultantId] || '';
  };

  const setViewDate = (consultantId: string, date: Date) => {
    setViewDates(prev => ({ ...prev, [consultantId]: date }));
  };

  const setSelectedDate = (consultantId: string, date: string) => {
    setSelectedDates(prev => ({ ...prev, [consultantId]: date }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-red-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        {config?.business?.company_name && (
          <div className="text-center mb-6">
            {config.business.logo_url && (
              <img
                src={config.business.logo_url}
                alt={config.business.company_name}
                className="h-12 mx-auto mb-2"
              />
            )}
            <h1 className="text-2xl font-bold dark:text-white">{config.business.company_name}</h1>
            <p className="text-gray-500 dark:text-gray-400">Онлайн-запись на консультацию</p>
          </div>
        )}

        {/* Step: Slot Selection */}
        {step === 'select' && (
          <div className="space-y-6">
            {Object.entries(slotsByConsultant).map(([consultantId, { name, slots: consultantSlots }]) => {
              const slotsByDate = groupSlotsByDate(consultantSlots);
              const viewDate = getViewDate(consultantId);
              const selectedDate = getSelectedDate(consultantId);
              const datesInView = getDatesInView(viewDate);

              return (
                <Card key={consultantId}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="w-5 h-5" />
                        {name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            const newDate = new Date(viewDate);
                            newDate.setDate(newDate.getDate() - 7);
                            setViewDate(consultantId, newDate);
                          }}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            const newDate = new Date(viewDate);
                            newDate.setDate(newDate.getDate() + 7);
                            setViewDate(consultantId, newDate);
                          }}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Date tabs */}
                    <div className="flex overflow-x-auto gap-2 mb-4 pb-2">
                      {datesInView.map(date => {
                        const dateStr = formatDate(date);
                        const hasSlots = slotsByDate[dateStr]?.length > 0;
                        const isSelected = selectedDate === dateStr;
                        const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                        return (
                          <button
                            key={dateStr}
                            onClick={() => !isPast && hasSlots && setSelectedDate(consultantId, dateStr)}
                            disabled={isPast || !hasSlots}
                            className={`
                              flex-shrink-0 px-4 py-2 rounded-lg text-center min-w-[80px]
                              ${isSelected ? 'bg-primary text-white' : ''}
                              ${!isSelected && hasSlots && !isPast ? 'border hover:border-primary dark:border-gray-700' : ''}
                              ${isPast || !hasSlots ? 'opacity-40 cursor-not-allowed' : ''}
                            `}
                          >
                            <div className="text-xs uppercase">
                              {['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][date.getDay()]}
                            </div>
                            <div className="font-bold">{date.getDate()}</div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Time slots */}
                    {selectedDate && slotsByDate[selectedDate] && (
                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                        {slotsByDate[selectedDate].map((slot, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setStep('details');
                            }}
                            className="p-2 rounded border text-center text-sm hover:border-primary hover:bg-primary/5 dark:border-gray-700 dark:hover:border-primary transition-colors"
                          >
                            {slot.start_time}
                          </button>
                        ))}
                      </div>
                    )}

                    {!selectedDate && (
                      <p className="text-center text-gray-500 dark:text-gray-400 py-4">
                        Выберите дату для просмотра доступного времени
                      </p>
                    )}

                    {selectedDate && (!slotsByDate[selectedDate] || slotsByDate[selectedDate].length === 0) && (
                      <p className="text-center text-gray-500 dark:text-gray-400 py-4">
                        Нет доступного времени на выбранную дату
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {slots.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    К сожалению, в ближайшее время нет доступных слотов для записи
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Step: Contact Details */}
        {step === 'details' && selectedSlot && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Ваши контакты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary */}
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg space-y-1 text-sm text-gray-900 dark:text-gray-100">
                <div><strong>Специалист:</strong> {selectedSlot.consultant_name}</div>
                <div><strong>Дата:</strong> {formatDisplayDate(selectedSlot.date)}</div>
                <div><strong>Время:</strong> {selectedSlot.start_time}</div>
              </div>

              <div>
                <Label>Ваше имя *</Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Иван Иванов"
                />
              </div>

              <div>
                <Label>Телефон *</Label>
                <Input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="+7 (999) 123-45-67"
                  type="tel"
                />
              </div>

              <div>
                <Label>Комментарий (опционально)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Дополнительная информация..."
                  rows={2}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedSlot(null);
                    setStep('select');
                  }}
                  disabled={isSubmitting}
                >
                  Назад
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  disabled={!clientName || !clientPhone || isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Записаться
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-xl font-bold mb-2 dark:text-white">Запись подтверждена!</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">{successMessage}</p>
              <Button
                onClick={() => window.location.href = 'https://ai.performanteaiagency.com/'}
              >
                Вернуться на сайт
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
