import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Calendar, Clock, User, Phone, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
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

type Step = 'service' | 'consultant' | 'datetime' | 'details' | 'success';

export function PublicBooking() {
  const { userAccountId } = useParams<{ userAccountId: string }>();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<Step>('service');
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Selected values
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedConsultant, setSelectedConsultant] = useState<Consultant | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Form values
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');

  // Date navigation
  const [viewDate, setViewDate] = useState(new Date());

  // Pre-select from URL params
  useEffect(() => {
    const consultantId = searchParams.get('consultant');
    const serviceId = searchParams.get('service');

    if (config) {
      if (serviceId) {
        const service = config.services.find(s => s.id === serviceId);
        if (service) {
          setSelectedService(service);
          setStep('consultant');
        }
      }
      if (consultantId) {
        const consultant = config.consultants.find(c => c.id === consultantId);
        if (consultant) {
          setSelectedConsultant(consultant);
          if (selectedService) {
            setStep('datetime');
          } else {
            setStep('service');
          }
        }
      }
    }
  }, [config, searchParams]);

  // Load config
  useEffect(() => {
    if (!userAccountId) return;

    const loadConfig = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/public/booking/${userAccountId}/config`);
        if (!response.ok) throw new Error('Failed to load configuration');
        const data = await response.json();
        setConfig(data);

        // If no services, skip to consultant
        if (!data.services.length) {
          setStep('consultant');
        }
      } catch (err) {
        setError('Не удалось загрузить форму записи');
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [userAccountId]);

  // Load slots when consultant is selected
  useEffect(() => {
    if (!userAccountId || !selectedConsultant) return;

    const loadSlots = async () => {
      try {
        const params = new URLSearchParams({
          consultant_id: selectedConsultant.id,
          days_ahead: '14'
        });
        if (selectedService) {
          params.append('service_id', selectedService.id);
        }

        const response = await fetch(`${API_BASE_URL}/public/booking/${userAccountId}/slots?${params}`);
        if (!response.ok) throw new Error('Failed to load slots');
        const data = await response.json();
        setSlots(data.slots || []);
      } catch (err) {
        console.error('Error loading slots:', err);
      }
    };

    loadSlots();
  }, [userAccountId, selectedConsultant, selectedService]);

  const handleSubmit = async () => {
    if (!userAccountId || !selectedConsultant || !selectedSlot || !clientName || !clientPhone) {
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
          consultant_id: selectedConsultant.id,
          service_id: selectedService?.id,
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

  // Group slots by date
  const slotsByDate = slots.reduce((acc, slot) => {
    if (!acc[slot.date]) {
      acc[slot.date] = [];
    }
    acc[slot.date].push(slot);
    return acc;
  }, {} as Record<string, Slot[]>);

  // Get dates for current week view
  const getDatesInView = () => {
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

  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDate();
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return `${weekdays[date.getDay()]}, ${day} ${months[date.getMonth()]}`;
  };

  const formatPrice = (price: number, currency: string) => {
    if (price === 0) return 'Бесплатно';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0
    }).format(price);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-red-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
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
            <h1 className="text-2xl font-bold">{config.business.company_name}</h1>
            <p className="text-gray-500">Онлайн-запись</p>
          </div>
        )}

        {/* Progress Steps */}
        {step !== 'success' && (
          <div className="flex justify-center gap-2 mb-6">
            {['service', 'consultant', 'datetime', 'details'].map((s, i) => (
              <div
                key={s}
                className={`w-3 h-3 rounded-full ${
                  ['service', 'consultant', 'datetime', 'details'].indexOf(step) >= i
                    ? 'bg-primary'
                    : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
        )}

        {/* Step: Service Selection */}
        {step === 'service' && config?.services && config.services.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Выберите услугу
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {config.services.map(service => (
                <button
                  key={service.id}
                  onClick={() => {
                    setSelectedService(service);
                    setStep('consultant');
                  }}
                  className="w-full p-4 border rounded-lg text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-4 h-4 rounded-full mt-1"
                      style={{ backgroundColor: service.color }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{service.name}</div>
                      {service.description && (
                        <div className="text-sm text-gray-500">{service.description}</div>
                      )}
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {service.duration_minutes} мин
                        </span>
                        <span>{formatPrice(service.price, service.currency)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setSelectedService(null);
                  setStep('consultant');
                }}
              >
                Пропустить выбор услуги
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step: Consultant Selection */}
        {step === 'consultant' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Выберите специалиста
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {config?.consultants.map(consultant => (
                <button
                  key={consultant.id}
                  onClick={() => {
                    setSelectedConsultant(consultant);
                    setStep('datetime');
                  }}
                  className="w-full p-4 border rounded-lg text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <div className="font-medium">{consultant.name}</div>
                  {consultant.specialization && (
                    <div className="text-sm text-gray-500">{consultant.specialization}</div>
                  )}
                </button>
              ))}

              {selectedService && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setStep('service')}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Назад
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step: Date/Time Selection */}
        {step === 'datetime' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Выберите время
                </CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const newDate = new Date(viewDate);
                      newDate.setDate(newDate.getDate() - 7);
                      setViewDate(newDate);
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
                      setViewDate(newDate);
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
                {getDatesInView().map(date => {
                  const dateStr = formatDate(date);
                  const hasSlots = slotsByDate[dateStr]?.length > 0;
                  const isSelected = selectedDate === dateStr;
                  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                  return (
                    <button
                      key={dateStr}
                      onClick={() => !isPast && hasSlots && setSelectedDate(dateStr)}
                      disabled={isPast || !hasSlots}
                      className={`
                        flex-shrink-0 px-4 py-2 rounded-lg text-center min-w-[80px]
                        ${isSelected ? 'bg-primary text-white' : ''}
                        ${!isSelected && hasSlots && !isPast ? 'border hover:border-primary' : ''}
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
                <div className="grid grid-cols-4 gap-2">
                  {slotsByDate[selectedDate].map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedSlot(slot);
                        setStep('details');
                      }}
                      className={`
                        p-2 rounded border text-center hover:border-primary hover:bg-primary/5
                        ${selectedSlot?.start_time === slot.start_time && selectedSlot?.date === slot.date
                          ? 'border-primary bg-primary/10'
                          : ''}
                      `}
                    >
                      {slot.start_time}
                    </button>
                  ))}
                </div>
              )}

              {!selectedDate && (
                <p className="text-center text-gray-500 py-4">
                  Выберите дату для просмотра доступного времени
                </p>
              )}

              {selectedDate && (!slotsByDate[selectedDate] || slotsByDate[selectedDate].length === 0) && (
                <p className="text-center text-gray-500 py-4">
                  Нет доступного времени на выбранную дату
                </p>
              )}

              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => setStep('consultant')}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Назад
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step: Contact Details */}
        {step === 'details' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Ваши контакты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary */}
              <div className="p-4 bg-gray-100 rounded-lg space-y-1 text-sm">
                {selectedService && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: selectedService.color }}
                    />
                    <span>{selectedService.name}</span>
                  </div>
                )}
                <div><strong>Специалист:</strong> {selectedConsultant?.name}</div>
                <div><strong>Дата:</strong> {selectedSlot && formatDisplayDate(selectedSlot.date)}</div>
                <div><strong>Время:</strong> {selectedSlot?.start_time}</div>
                {selectedService && selectedService.price > 0 && (
                  <div><strong>Стоимость:</strong> {formatPrice(selectedService.price, selectedService.currency)}</div>
                )}
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
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep('datetime')}
                  disabled={isSubmitting}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
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
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold mb-2">Запись подтверждена!</h2>
              <p className="text-gray-600 mb-6">{successMessage}</p>
              <Button
                onClick={() => {
                  setStep('service');
                  setSelectedService(null);
                  setSelectedConsultant(null);
                  setSelectedDate('');
                  setSelectedSlot(null);
                  setClientName('');
                  setClientPhone('');
                  setNotes('');
                  setSuccessMessage(null);
                }}
              >
                Записаться ещё раз
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
