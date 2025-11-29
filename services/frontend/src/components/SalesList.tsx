import React, { useEffect, useState, useMemo } from 'react';
import { salesApi } from '@/services/salesApi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingCart, Edit, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportToCSV, formatDateForExport, formatAmountForExport, formatDateTime } from '@/lib/exportUtils';

const ITEMS_PER_PAGE = 20;
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from '@/components/ui/select';

interface Purchase {
  id: string;
  client_phone: string;
  amount: number;
  campaign_name?: string;
  created_at: string;
}

interface SalesListProps {
  userAccountId: string;
}

const SalesList: React.FC<SalesListProps> = ({ userAccountId }) => {
  const [sales, setSales] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Purchase>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<{id: string, name: string}[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Пагинация
  const totalPages = Math.ceil(sales.length / ITEMS_PER_PAGE);
  const paginatedSales = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return sales.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sales, currentPage]);

  const loadSales = async () => {
    setLoading(true);
    const { data, error } = await salesApi.getAllPurchases(userAccountId);
    if (!error && data) setSales(data);
    setLoading(false);
  };

  const loadCampaigns = async (userAccountId: string) => {
    setLoadingCampaigns(true);
    try {
      const result = await salesApi.getExistingCampaigns(userAccountId);
      setCampaigns(result);
    } catch (e) {
      setCampaigns([]);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    if (userAccountId) loadSales();
    // eslint-disable-next-line
  }, [userAccountId]);

  const startEdit = (sale: Purchase) => {
    setEditingId(sale.id);
    setEditData({
      client_phone: sale.client_phone,
      amount: sale.amount,
      campaign_name: sale.campaign_name || '',
    });
    if (userAccountId) loadCampaigns(userAccountId);
    setModalOpen(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
    setModalOpen(false);
  };

  const saveEdit = async (id: string) => {
    await salesApi.updatePurchase(id, editData);
    setEditingId(null);
    setEditData({});
    setModalOpen(false);
    loadSales();
  };

  const handleExport = () => {
    exportToCSV(sales, [
      { header: 'Дата', accessor: (s) => formatDateForExport(s.created_at) },
      { header: 'Телефон', accessor: (s) => s.client_phone },
      { header: 'Сумма', accessor: (s) => formatAmountForExport(s.amount) },
      { header: 'Креатив', accessor: (s) => s.campaign_name || '' },
    ], 'sales');
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          Список продаж ({sales.length})
        </h2>
        {sales.length > 0 && (
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
      {loading ? (
        <Card className="shadow-sm">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : sales.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="p-3 rounded-full bg-muted inline-flex items-center justify-center mb-4">
                <ShoppingCart className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-2">Нет продаж</h3>
              <p className="text-sm text-muted-foreground">
                Добавьте продажи для отслеживания ROI
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Дата</th>
                    <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Телефон</th>
                    <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Сумма</th>
                    <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap hidden sm:table-cell">Креатив</th>
                    <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground whitespace-nowrap">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSales.map((sale) => (
                    <tr key={sale.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 whitespace-nowrap text-xs">{formatDateTime(sale.created_at)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{sale.client_phone}</td>
                      <td className="py-2 px-3 text-left whitespace-nowrap font-medium text-green-600">{sale.amount} ₸</td>
                      <td className="py-2 px-3 whitespace-nowrap hidden sm:table-cell text-xs">{sale.campaign_name || '—'}</td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <Dialog open={modalOpen && editingId === sale.id} onOpenChange={setModalOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              title="Редактировать"
                              onClick={() => startEdit(sale)}
                              aria-label="Редактировать"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Редактировать продажу</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3 mt-4">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">Телефон клиента</label>
                            <Input
                              value={editData.client_phone || ''}
                              onChange={e => setEditData({ ...editData, client_phone: e.target.value })}
                              placeholder="+7 (___) ___-__-__"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">Сумма продажи</label>
                            <Input
                              type="number"
                              value={editData.amount || ''}
                              onChange={e => setEditData({ ...editData, amount: Number(e.target.value) })}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">Кампания</label>
                            {loadingCampaigns ? (
                              <div className="text-center text-xs text-muted-foreground py-2">Загрузка кампаний...</div>
                            ) : (
                              <Select
                                value={campaigns.find(c => c.name === editData.campaign_name)?.id || ''}
                                onValueChange={val => {
                                  const selected = campaigns.find(c => c.id === val);
                                  setEditData({ ...editData, campaign_name: selected ? selected.name : '' });
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Выберите кампанию" />
                                </SelectTrigger>
                                <SelectContent>
                                  {campaigns.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                        <DialogFooter className="mt-6 gap-2">
                          <DialogClose asChild>
                            <Button variant="outline" onClick={cancelEdit}>Отмена</Button>
                          </DialogClose>
                          <Button onClick={() => saveEdit(sale.id)}>Сохранить</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
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
                Показано {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sales.length)} из {sales.length}
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
      )}
    </div>
  );
};

export default SalesList; 