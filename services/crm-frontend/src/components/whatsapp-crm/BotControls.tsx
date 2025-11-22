import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Bot, 
  User, 
  Play, 
  Pause, 
  Send,
  Loader2 
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface BotControlsProps {
  leadId: string;
  assignedToHuman?: boolean;
  botPaused?: boolean;
  botPausedUntil?: string;
  lastBotMessageAt?: string;
  onUpdate?: () => void;
}

export function BotControls({ 
  leadId, 
  assignedToHuman, 
  botPaused, 
  botPausedUntil,
  lastBotMessageAt,
  onUpdate 
}: BotControlsProps) {
  const [loading, setLoading] = useState(false);

  // Определить текущий статус бота
  const getBotStatus = () => {
    if (assignedToHuman) return { status: 'human', label: 'Менеджер в работе', icon: User, variant: 'default' as const };
    if (botPaused || (botPausedUntil && new Date(botPausedUntil) > new Date())) {
      return { status: 'paused', label: 'Бот на паузе', icon: Pause, variant: 'secondary' as const };
    }
    return { status: 'active', label: 'Бот активен', icon: Bot, variant: 'default' as const };
  };

  const currentStatus = getBotStatus();

  // API вызовы
  const handleTakeOver = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/chatbot/take-over', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });

      if (!response.ok) throw new Error('Failed to take over');

      toast({ title: 'Лид взят в работу' });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Ошибка при взятии лида в работу', variant: 'destructive' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToBot = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/chatbot/return-to-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });

      if (!response.ok) throw new Error('Failed to return to bot');

      toast({ title: 'Лид возвращён боту' });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Ошибка при возврате лида боту', variant: 'destructive' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async (duration?: number) => {
    setLoading(true);
    try {
      const response = await fetch('/api/chatbot/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, duration }),
      });

      if (!response.ok) throw new Error('Failed to pause bot');

      toast({ title: duration ? `Бот на паузе на ${duration}ч` : 'Бот на паузе' });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Ошибка при остановке бота', variant: 'destructive' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/chatbot/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });

      if (!response.ok) throw new Error('Failed to resume bot');

      toast({ title: 'Бот возобновлён' });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Ошибка при возобновлении бота', variant: 'destructive' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendFollowUp = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/chatbot/send-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });

      if (!response.ok) throw new Error('Failed to send follow-up');

      toast({ title: 'Догоняющее сообщение отправлено' });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Ошибка при отправке сообщения', variant: 'destructive' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const StatusIcon = currentStatus.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className="h-5 w-5" />
            <CardTitle>Управление ботом</CardTitle>
          </div>
          <Badge variant={currentStatus.variant}>
            {currentStatus.label}
          </Badge>
        </div>
        <CardDescription>
          {lastBotMessageAt && (
            <span className="text-xs">
              Последнее сообщение: {new Date(lastBotMessageAt).toLocaleString('ru')}
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-2">
          {/* Взять в работу / Вернуть боту */}
          {!assignedToHuman ? (
            <Button
              onClick={handleTakeOver}
              disabled={loading}
              variant="default"
              size="sm"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <User className="h-4 w-4 mr-2" />
              )}
              Взять в работу
            </Button>
          ) : (
            <Button
              onClick={handleReturnToBot}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Bot className="h-4 w-4 mr-2" />
              )}
              Вернуть боту
            </Button>
          )}

          {/* Пауза / Возобновить */}
          {!assignedToHuman && (
            <>
              {!botPaused && (!botPausedUntil || new Date(botPausedUntil) < new Date()) ? (
                <>
                  <Button
                    onClick={() => handlePause()}
                    disabled={loading}
                    variant="secondary"
                    size="sm"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Pause className="h-4 w-4 mr-2" />
                    )}
                    Пауза
                  </Button>
                  <Button
                    onClick={() => handlePause(24)}
                    disabled={loading}
                    variant="ghost"
                    size="sm"
                  >
                    Пауза 24ч
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleResume}
                  disabled={loading}
                  variant="default"
                  size="sm"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Возобновить
                </Button>
              )}
            </>
          )}

          {/* Догоняющее сообщение */}
          <Button
            onClick={handleSendFollowUp}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Отправить догоняющее
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}






