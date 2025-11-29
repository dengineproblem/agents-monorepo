import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, AlertTriangle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { salesApi } from '@/services/salesApi';
import { AssignCreativeModal } from './AssignCreativeModal';
import { exportToCSV, formatDateForExport, formatAmountForExport, formatDateTime } from '@/lib/exportUtils';

const ITEMS_PER_PAGE = 20;

interface Lead {
  id: string;
  chat_id: string;
  creative_id: string | null;
  creative_name?: string;
  direction_id: string | null;
  direction_name?: string;
  needs_manual_match: boolean;
  sale_amount?: number;
  created_at: string;
}

interface LeadsTabProps {
  userAccountId: string;
  directionId: string | null;
}

export const LeadsTab: React.FC<LeadsTabProps> = ({ userAccountId, directionId }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await salesApi.getLeadsForROI(userAccountId, directionId);
      if (!error && data) {
        setLeads(data);
      }
    } catch (e) {
      console.error('Error loading leads:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userAccountId) {
      loadLeads();
      setCurrentPage(1); // Сбрасываем страницу при смене фильтров
    }
  }, [userAccountId, directionId]);

  const handleAssignCreative = (lead: Lead) => {
    setSelectedLead(lead);
    setModalOpen(true);
  };

  const handleCreativeAssigned = () => {
    setModalOpen(false);
    setSelectedLead(null);
    loadLeads();
  };

  const leadsNeedingMatch = leads.filter(l => l.needs_manual_match && !l.creative_id);

  // Пагинация для основной таблицы
  const totalPages = Math.ceil(leads.length / ITEMS_PER_PAGE);
  const paginatedLeads = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return leads.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [leads, currentPage]);

  const formatPhone = (phone: string) => {
    if (!phone) return '—';
    // Формат: +7 777 123 45 67
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `+${cleaned[0]} ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7, 9)} ${cleaned.slice(9)}`;
    }
    return phone;
  };

  const handleExport = () => {
    exportToCSV(leads, [
      { header: 'Телефон', accessor: (l) => l.chat_id },
      { header: 'Креатив', accessor: (l) => l.creative_name || '' },
      { header: 'Направление', accessor: (l) => l.direction_name || '' },
      { header: 'Сумма продажи', accessor: (l) => formatAmountForExport(l.sale_amount) },
      { header: 'Требует привязки', accessor: (l) => l.needs_manual_match ? 'Да' : 'Нет' },
      { header: 'Дата', accessor: (l) => formatDateForExport(l.created_at) },
    ], 'leads');
  };

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Загрузка...
        </CardContent>
      </Card>
    );
  }

  if (leads.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="p-3 rounded-full bg-muted inline-flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-2">Нет лидов</h3>
            <p className="text-sm text-muted-foreground">
              Лиды появятся после получения сообщений из рекламы
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Секция: Требуют привязки креатива */}
      {leadsNeedingMatch.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-800/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Требуют привязки к креативу ({leadsNeedingMatch.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-amber-200/50">
                  <tr>
                    <th className="py-2 px-3 text-left text-xs font-medium text-amber-700/70 whitespace-nowrap">Телефон</th>
                    <th className="py-2 px-3 text-left text-xs font-medium text-amber-700/70 whitespace-nowrap">Направление</th>
                    <th className="py-2 px-3 text-left text-xs font-medium text-amber-700/70 whitespace-nowrap">Дата</th>
                    <th className="py-2 px-3 text-center text-xs font-medium text-amber-700/70 whitespace-nowrap">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsNeedingMatch.map((lead) => (
                    <tr key={lead.id} className="border-b border-amber-200/30 last:border-0">
                      <td className="py-2 px-3 whitespace-nowrap font-medium">{formatPhone(lead.chat_id)}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-xs">{lead.direction_name || '—'}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-xs">
                        {formatDateTime(lead.created_at)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                          onClick={() => handleAssignCreative(lead)}
                        >
                          Выбрать креатив
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Секция: Все лиды */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Все лиды ({leads.length})
            </h3>
            {leads.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleExport}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Экспорт
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Телефон</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Креатив</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap hidden sm:table-cell">Направление</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap hidden md:table-cell">Продажа</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Дата</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap font-medium">{formatPhone(lead.chat_id)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {lead.creative_name ? (
                        <span className="text-xs">{lead.creative_name}</span>
                      ) : lead.needs_manual_match ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-amber-600 hover:text-amber-700 p-0"
                          onClick={() => handleAssignCreative(lead)}
                        >
                          + Выбрать
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs hidden sm:table-cell">
                      {lead.direction_name || '—'}
                    </td>
                    <td className="py-2 px-3 text-left whitespace-nowrap hidden md:table-cell">
                      {lead.sale_amount ? (
                        <span className="text-green-600 font-medium">{lead.sale_amount} ₸</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs">
                      {formatDateTime(lead.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <div className="text-xs text-muted-foreground">
                Показано {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, leads.length)} из {leads.length}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Модальное окно выбора креатива */}
      {selectedLead && (
        <AssignCreativeModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSelectedLead(null);
          }}
          onAssigned={handleCreativeAssigned}
          leadId={selectedLead.id}
          leadPhone={formatPhone(selectedLead.chat_id)}
          userAccountId={userAccountId}
          directionId={selectedLead.direction_id}
        />
      )}
    </div>
  );
};

export default LeadsTab;
