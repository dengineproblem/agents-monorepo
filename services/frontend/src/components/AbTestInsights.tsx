import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { FlaskConical, Trophy, TrendingUp, Eye, RefreshCw, Loader2, MessageSquare, Image as ImageIcon } from 'lucide-react';
import { creativeAbTestApi, type AbTest, type AbTestInsight } from '@/services/creativeAbTestApi';
import { format } from 'date-fns';

type AbTestInsightsProps = {
  onRefresh?: () => void;
};

const statusLabels: Record<AbTest['status'], { label: string; className: string }> = {
  pending: { label: 'Ожидание', className: 'bg-muted text-muted-foreground' },
  running: { label: 'Выполняется', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' },
  completed: { label: 'Завершён', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' },
  failed: { label: 'Ошибка', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' },
  cancelled: { label: 'Отменён', className: 'bg-muted text-muted-foreground' },
};

export const AbTestInsights: React.FC<AbTestInsightsProps> = ({ onRefresh }) => {
  const [tests, setTests] = useState<AbTest[]>([]);
  const [offerInsights, setOfferInsights] = useState<AbTestInsight[]>([]);
  const [imageInsights, setImageInsights] = useState<AbTestInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('tests');

  const loadData = async () => {
    setLoading(true);
    try {
      const [testsResult, insightsResult] = await Promise.all([
        creativeAbTestApi.getActiveTests(),
        creativeAbTestApi.getInsights()
      ]);

      if (testsResult.success && testsResult.tests) {
        setTests(testsResult.tests);
      }

      if (insightsResult.success) {
        setOfferInsights(insightsResult.offer_texts || []);
        setImageInsights(insightsResult.creative_images || []);
      }
    } catch (error) {
      console.error('Error loading A/B test data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    loadData();
    onRefresh?.();
  };

  const runningTests = tests.filter(t => t.status === 'running');
  const completedTests = tests.filter(t => t.status === 'completed');

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hasData = tests.length > 0 || offerInsights.length > 0 || imageInsights.length > 0;

  if (!hasData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              A/B Тесты
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={handleRefresh} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            Пока нет A/B тестов. Выберите 2-5 креативов и нажмите "A/B тест".
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            A/B Тесты
            {runningTests.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {runningTests.length} активных
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={handleRefresh} className="h-7 w-7 p-0">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="tests" className="text-xs">
              Тесты ({tests.length})
            </TabsTrigger>
            <TabsTrigger value="offers" className="text-xs">
              Офферы ({offerInsights.length})
            </TabsTrigger>
            <TabsTrigger value="images" className="text-xs">
              Образы ({imageInsights.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tests" className="space-y-3">
            {tests.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Нет A/B тестов
              </div>
            ) : (
              tests.slice(0, 5).map((test) => {
                const totalImpressions = test.items?.reduce((sum, item) => sum + item.impressions, 0) || 0;
                const totalLimit = test.impressions_per_creative * test.creatives_count;
                const progress = totalLimit > 0 ? Math.min((totalImpressions / totalLimit) * 100, 100) : 0;

                return (
                  <div key={test.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className={statusLabels[test.status].className}>
                          {statusLabels[test.status].label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {test.creatives_count} креативов
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(test.created_at), 'dd.MM.yy HH:mm')}
                      </span>
                    </div>

                    {test.status === 'running' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Прогресс</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                        <div className="text-xs text-muted-foreground">
                          {totalImpressions.toLocaleString()} / {totalLimit.toLocaleString()} показов
                        </div>
                      </div>
                    )}

                    {test.status === 'completed' && test.winner_creative_id && test.items && (
                      <div className="flex items-center gap-2 text-sm">
                        <Trophy className="h-4 w-4 text-amber-500" />
                        <span>Победитель: #{test.items.findIndex(i => i.user_creative_id === test.winner_creative_id) + 1}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="offers" className="space-y-2">
            {offerInsights.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Нет инсайтов по офферам
              </div>
            ) : (
              offerInsights.slice(0, 10).map((insight, index) => (
                <div key={index} className="p-3 border rounded-lg space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      {index < 3 ? (
                        <Trophy className={`h-4 w-4 ${
                          index === 0 ? 'text-amber-500' :
                          index === 1 ? 'text-gray-400' :
                          'text-amber-700'
                        }`} />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">{insight.content}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {insight.occurrence_count}x
                    </span>
                    {insight.metadata?.wins !== undefined && (
                      <span className="flex items-center gap-1">
                        <Trophy className="h-3 w-3" />
                        {insight.metadata.wins} побед
                      </span>
                    )}
                    {insight.metadata?.last_ctr !== undefined && (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        CTR {insight.metadata.last_ctr.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="images" className="space-y-2">
            {imageInsights.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Нет инсайтов по образам
              </div>
            ) : (
              imageInsights.slice(0, 10).map((insight, index) => (
                <div key={index} className="p-3 border rounded-lg space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      {index < 3 ? (
                        <Trophy className={`h-4 w-4 ${
                          index === 0 ? 'text-amber-500' :
                          index === 1 ? 'text-gray-400' :
                          'text-amber-700'
                        }`} />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">{insight.content}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {insight.occurrence_count}x
                    </span>
                    {insight.metadata?.wins !== undefined && (
                      <span className="flex items-center gap-1">
                        <Trophy className="h-3 w-3" />
                        {insight.metadata.wins} побед
                      </span>
                    )}
                    {insight.metadata?.last_ctr !== undefined && (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        CTR {insight.metadata.last_ctr.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
