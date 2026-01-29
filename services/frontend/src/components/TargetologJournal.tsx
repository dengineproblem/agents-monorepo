import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, User, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface TargetologAction {
  id: number;
  user_id: string;
  username: string;
  action_text: string;
  created_at: string;
  created_by: string;
}

const TargetologJournal: React.FC = () => {
  const [actions, setActions] = useState<TargetologAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Загрузка действий таргетолога для текущего пользователя
  useEffect(() => {
    const loadTargetologActions = async () => {
      try {
        setLoading(true);
        setError(null);

        // Получаем текущего пользователя из localStorage
        const storedUser = localStorage.getItem('user');
        if (!storedUser) {
          setError('Пользователь не найден');
          return;
        }

        const user = JSON.parse(storedUser);
        if (!user.id) {
          setError('ID пользователя не найден');
          return;
        }

        // Загружаем действия таргетолога для этого пользователя
        const { data, error: fetchError } = await supabase
          .from('targetolog_actions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50); // Последние 50 действий

        if (fetchError) {

          setError('Не удалось загрузить журнал действий');
          return;
        }

        setActions(data || []);
      } catch (err) {

        setError('Произошла ошибка при загрузке данных');
      } finally {
        setLoading(false);
      }
    };

    loadTargetologActions();
  }, []);

  // Простая иконка для всех действий
  const getActionIcon = () => {
    return <FileText className="h-4 w-4 text-blue-600" />;
  };

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Журнал действий таргетолога
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-in fade-in duration-300">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3 border rounded-lg">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-muted via-muted/50 to-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-muted/70 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-muted/50 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Журнал действий таргетолога
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="text-red-600 mb-2">⚠️</div>
            <div className="text-sm text-muted-foreground">{error}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (actions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Журнал действий таргетолога
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <div>Пока нет записей в журнале</div>
            <div className="text-xs">Действия таргетолога будут отображаться здесь</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Журнал действий таргетолога
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96 w-full">
          <div className="space-y-4 animate-in fade-in duration-500">
            {actions.map((action, index) => (
              <div
                key={action.id}
                className="border rounded-lg p-4 hover:bg-muted/30 transition-all duration-200 hover:shadow-sm animate-in fade-in"
                style={{ animationDelay: `${index * 50}ms`, animationDuration: '500ms' }}
              >
                <div className="flex items-start gap-3 mb-3">
                  {getActionIcon()}
                  <div className="flex-1">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {action.action_text}
                    </div>
                  </div>
                </div>

                {/* Метаинформация */}
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(action.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                  </div>
                  {action.created_by && (
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {action.created_by}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default TargetologJournal;