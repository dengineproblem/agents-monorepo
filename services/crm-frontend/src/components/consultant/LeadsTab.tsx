import { useState, useEffect } from 'react';
import { consultantApi, Lead } from '@/services/consultantApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Phone, MessageSquare, Calendar, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export function LeadsTab() {
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    is_booked: 'all',
    interest_level: 'all',
    search: '',
  });

  // Модальное окно для лида
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Загрузка лидов
  const loadLeads = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (filters.is_booked && filters.is_booked !== 'all') params.is_booked = filters.is_booked;
      if (filters.interest_level && filters.interest_level !== 'all') params.interest_level = filters.interest_level;

      const data = await consultantApi.getLeads(params);
      setLeads(data.leads);
      setTotal(data.total);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить лидов',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
  }, [filters]);

  // Загрузка сообщений для лида
  const loadMessages = async (leadId: string) => {
    try {
      setLoadingMessages(true);
      const data = await consultantApi.getMessages(leadId);
      setMessages(data.messages || []);
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить переписку',
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
    }
  };

  // Открыть модальное окно лида
  const handleOpenLead = (lead: Lead) => {
    setSelectedLead(lead);
    loadMessages(lead.id);
  };

  // Отправить сообщение
  const handleSendMessage = async () => {
    if (!selectedLead || !newMessage.trim()) return;

    try {
      setSendingMessage(true);
      await consultantApi.sendMessage(selectedLead.id, newMessage);

      toast({
        title: 'Успешно',
        description: 'Сообщение отправлено',
      });

      // Обновить список сообщений
      await loadMessages(selectedLead.id);
      setNewMessage('');
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось отправить сообщение',
        variant: 'destructive',
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const getInterestBadge = (level?: string) => {
    if (!level) return null;

    const colors: Record<string, string> = {
      hot: 'bg-red-500',
      warm: 'bg-yellow-500',
      cold: 'bg-blue-500',
    };

    const labels: Record<string, string> = {
      hot: 'Горячий',
      warm: 'Теплый',
      cold: 'Холодный',
    };

    return (
      <Badge className={colors[level] || 'bg-gray-500'}>
        {labels[level] || level}
      </Badge>
    );
  };

  const filteredLeads = leads.filter(lead => {
    if (!filters.search) return true;
    const search = filters.search.toLowerCase();
    return (
      lead.contact_name?.toLowerCase().includes(search) ||
      lead.contact_phone?.toLowerCase().includes(search)
    );
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Мои лиды</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Фильтры */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Поиск по имени или телефону..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full"
              />
            </div>

            <Select
              value={filters.is_booked}
              onValueChange={(value) => setFilters({ ...filters, is_booked: value })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Статус записи" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="false">Не записан</SelectItem>
                <SelectItem value="true">Записан</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.interest_level}
              onValueChange={(value) => setFilters({ ...filters, interest_level: value })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Уровень интереса" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="hot">Горячий</SelectItem>
                <SelectItem value="warm">Теплый</SelectItem>
                <SelectItem value="cold">Холодный</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Таблица лидов */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Лидов не найдено
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => handleOpenLead(lead)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {lead.contact_name || 'Без имени'}
                      </span>
                      {getInterestBadge(lead.interest_level)}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {lead.contact_phone}
                      </span>
                      {lead.last_message && (
                        <span className="text-xs">
                          {format(new Date(lead.last_message), 'dd MMM, HH:mm', { locale: ru })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenLead(lead);
                      }}
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Написать
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 text-sm text-muted-foreground">
            Всего лидов: {total}
          </div>
        </CardContent>
      </Card>

      {/* Модальное окно лида */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selectedLead?.contact_name || 'Без имени'} ({selectedLead?.contact_phone})
            </DialogTitle>
          </DialogHeader>

          {/* Переписка */}
          <div className="flex-1 overflow-y-auto border rounded-lg p-4 space-y-3">
            {loadingMessages ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                Нет сообщений
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-4 py-2 ${
                      msg.from_me
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                    <p className="text-xs mt-1 opacity-70">
                      {format(new Date(msg.timestamp), 'HH:mm', { locale: ru })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Форма отправки */}
          <div className="flex gap-2 pt-4 border-t">
            <Textarea
              placeholder="Введите сообщение..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1"
              rows={2}
            />
            <Button
              onClick={handleSendMessage}
              disabled={sendingMessage || !newMessage.trim()}
            >
              {sendingMessage ? 'Отправка...' : 'Отправить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
