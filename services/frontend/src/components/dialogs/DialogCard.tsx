import { DialogAnalysis } from '@/types/dialogAnalysis';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Phone, Building2, Target, AlertCircle, MessageSquare, Copy, Send, Eye, Instagram } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

interface DialogCardProps {
  dialog: DialogAnalysis;
  onViewDetails?: (dialog: DialogAnalysis) => void;
  onSendMessage?: (dialog: DialogAnalysis) => void;
}

export function DialogCard({ dialog, onViewDetails, onSendMessage }: DialogCardProps) {
  const { toast } = useToast();
  const [copying, setCopying] = useState(false);

  const getInterestBadge = () => {
    switch (dialog.interest_level) {
      case 'hot':
        return { emoji: '🔥', label: 'HOT', className: 'bg-red-500 hover:bg-red-600 text-white' };
      case 'warm':
        return { emoji: '🌤️', label: 'WARM', className: 'bg-orange-500 hover:bg-orange-600 text-white' };
      case 'cold':
        return { emoji: '❄️', label: 'COLD', className: 'bg-blue-500 hover:bg-blue-600 text-white' };
      default:
        return { emoji: '❓', label: '—', className: 'bg-gray-500' };
    }
  };

  const getFunnelStageLabel = () => {
    switch (dialog.funnel_stage) {
      case 'new_lead': return 'Новый лид';
      case 'not_qualified': return 'Не квалифицирован';
      case 'qualified': return 'Квалифицирован';
      case 'consultation_booked': return 'Записан';
      case 'consultation_completed': return 'Прошел консультацию';
      case 'deal_closed': return 'Сделка закрыта ✓';
      case 'deal_lost': return 'Сделка проиграна';
      default: return '—';
    }
  };

  const getFunnelStageBadgeColor = () => {
    switch (dialog.funnel_stage) {
      case 'new_lead': return 'bg-gray-200';
      case 'not_qualified': return 'bg-yellow-200 text-yellow-800';
      case 'qualified': return 'bg-green-200 text-green-800';
      case 'consultation_booked': return 'bg-blue-200 text-blue-800';
      case 'consultation_completed': return 'bg-purple-200 text-purple-800';
      case 'deal_closed': return 'bg-green-500 text-white';
      case 'deal_lost': return 'bg-red-200 text-red-800';
      default: return 'bg-gray-200';
    }
  };

  const handleCopyMessage = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(dialog.next_message);
      toast({
        title: 'Скопировано!',
        description: 'Сообщение скопировано в буфер обмена',
      });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось скопировать',
        variant: 'destructive',
      });
    } finally {
      setCopying(false);
    }
  };

  const interestBadge = getInterestBadge();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Interest Level & Score */}
            <div className="flex flex-col items-center">
              <span className="text-3xl">{interestBadge.emoji}</span>
              <Badge className={interestBadge.className}>
                {dialog.score ?? '—'}
              </Badge>
            </div>
            
            {/* Name & Phone */}
            <div>
              <h3 className="text-lg font-semibold">
                {dialog.contact_name || 'Без имени'}
              </h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4" />
                <span>{dialog.contact_phone}</span>
              </div>
            </div>
          </div>
          
          {/* Last Message Time */}
          <div className="text-xs text-gray-500 text-right">
            {dialog.last_message && (
              <>
                <div>Последнее сообщение</div>
                <div className="font-medium">
                  {formatDistanceToNow(new Date(dialog.last_message), {
                    addSuffix: true,
                    locale: ru,
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Business Profile */}
        {dialog.business_type && (
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="font-medium">{dialog.business_type}</span>
            {dialog.is_owner && <Badge variant="secondary">Владелец</Badge>}
            {dialog.uses_ads_now && <Badge variant="outline">Запускает рекламу</Badge>}
            {dialog.ad_budget && <Badge variant="outline">Бюджет: {dialog.ad_budget}</Badge>}
          </div>
        )}

        {/* Instagram */}
        {dialog.instagram_url && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <Instagram className="w-4 h-4" />
            <a 
              href={dialog.instagram_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {dialog.instagram_url}
            </a>
          </div>
        )}
        
        {/* Funnel Stage */}
        <div className="flex items-center gap-2">
          <Badge className={getFunnelStageBadgeColor()}>
            {getFunnelStageLabel()}
          </Badge>
          {dialog.qualification_complete && (
            <Badge variant="outline" className="text-green-600 border-green-600">
              ✓ Квалифицирован
            </Badge>
          )}
        </div>

        {/* Intent & Action */}
        <div className="flex items-center gap-4 text-sm flex-wrap">
          {dialog.main_intent && (
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-500" />
              <span>
                {dialog.main_intent === 'ai_targetolog' && 'AI-таргетолог'}
                {dialog.main_intent === 'clinic_lead' && 'Лид для клиники'}
                {dialog.main_intent === 'marketing_analysis' && 'Маркетинг-анализ'}
                {dialog.main_intent === 'other' && 'Другое'}
              </span>
            </div>
          )}
          {dialog.action && dialog.action !== 'none' && (
            <Badge variant="secondary">
              {dialog.action === 'want_call' && 'Хочет звонок'}
              {dialog.action === 'want_work' && 'Готов работать'}
              {dialog.action === 'reserve' && 'Записался'}
            </Badge>
          )}
        </div>
        
        {/* Objection */}
        {dialog.objection && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium mb-1">Возражение:</div>
                <div className="text-gray-700">{dialog.objection}</div>
              </div>
            </div>
          </div>
        )}
        
        {/* Next Message */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5" />
            <div className="font-medium text-sm">Рекомендованное сообщение:</div>
          </div>
          <p className="text-sm mb-3 whitespace-pre-wrap">{dialog.next_message}</p>
          
          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleCopyMessage}
              disabled={copying}
            >
              <Copy className="w-3 h-3 mr-1" />
              {copying ? 'Копируется...' : 'Копировать'}
            </Button>
            {onSendMessage && (
              <Button 
                size="sm"
                onClick={() => onSendMessage(dialog)}
              >
                <Send className="w-3 h-3 mr-1" />
                Отправить в WhatsApp
              </Button>
            )}
            {onViewDetails && (
              <Button 
                size="sm"
                variant="ghost"
                onClick={() => onViewDetails(dialog)}
              >
                <Eye className="w-3 h-3 mr-1" />
                Подробнее
              </Button>
            )}
          </div>
        </div>

        {/* Message Counts */}
        <div className="flex gap-4 text-xs text-gray-500">
          <div>
            <span className="font-medium">Входящих:</span> {dialog.incoming_count}
          </div>
          <div>
            <span className="font-medium">Исходящих:</span> {dialog.outgoing_count}
          </div>
          <div>
            <span className="font-medium">Проанализировано:</span>{' '}
            {formatDistanceToNow(new Date(dialog.analyzed_at), { addSuffix: true, locale: ru })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

