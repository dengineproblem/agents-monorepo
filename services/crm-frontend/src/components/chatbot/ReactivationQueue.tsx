import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { chatbotApi } from '@/services/chatbotApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ReactivationLead {
  id: string;
  contactName: string;
  contactPhone: string;
  score: number;
  funnelStage: string;
  scheduledAt: string;
  lastMessage: string;
}

export function ReactivationQueue() {
  const [limit] = useState(300);

  // Fetch reactivation queue
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['reactivation-queue', limit],
    queryFn: () => chatbotApi.getReactivationQueue(limit),
  });

  const getFunnelStageLabel = (stage: string) => {
    const labels: Record<string, string> = {
      new_lead: 'Новый лид',
      not_qualified: 'Не квалифицирован',
      qualified: 'Квалифицирован',
      consultation_booked: 'Консультация назначена',
      consultation_completed: 'Консультация прошла',
      deal_closed: 'Сделка закрыта',
      deal_lost: 'Сделка потеряна',
    };
    return labels[stage] || stage;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'destructive';
    if (score >= 60) return 'default';
    return 'secondary';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Очередь реактивации</CardTitle>
        <CardDescription>
          Топ-{limit} лидов для отправки догоняющих сообщений (сортировка по score)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : queue.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Нет лидов для реактивации
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Имя</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Этап воронки</TableHead>
                  <TableHead>Время отправки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((lead: ReactivationLead, index: number) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>{lead.contactName || 'Без имени'}</TableCell>
                    <TableCell className="font-mono text-sm">{lead.contactPhone}</TableCell>
                    <TableCell>
                      <Badge variant={getScoreColor(lead.score)}>
                        {lead.score}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {getFunnelStageLabel(lead.funnelStage)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {lead.scheduledAt ? (
                        <span className="text-sm">
                          {format(new Date(lead.scheduledAt), 'dd MMM, HH:mm', { locale: ru })}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">Не запланировано</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

