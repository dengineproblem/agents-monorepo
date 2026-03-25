import React, { useEffect, useState, useMemo } from 'react';
import { salesApi } from '@/services/salesApi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingCart, Edit, Trash2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
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

interface Purchase {
  id: string;
  client_phone: string;
  amount: number;
  campaign_name?: string;
  source?: string;
  created_at: string;
}

interface SalesListProps {
  userAccountId: string;
  accountId?: string | null;  // UUID из ad_accounts.id для мультиаккаунтности
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Вручную',
  amocrm: 'AmoCRM',
  bitrix24: 'Bitrix24',
  crm_consultant: 'CRM',
};

const SalesList: React.FC<SalesListProps> = ({ userAccountId, accountId }) => {
  const [sales, setSales] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Purchase>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Пагинация
  const totalPages = Math.ceil(sales.length / ITEMS_PER_PAGE);
  const paginatedSales = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return sales.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sales, currentPage]);

  const loadSales = async () => {
    setLoading(true);
    const { data, error } = await salesApi.getAllPurchases(userAccountId, accountId);
    if (!error && data) setSales(data);
    setLoading(false);
  };

  useEffect(() => {
    if (userAccountId) loadSales();
    // eslint-disable-next-line
  }, [userAccountId, accountId]);

  const startEdit = (sale: Purchase) => {
    setEditingId(sale.id);
    setEditData({
      client_phone: sale.client_phone,
      amount: sale.amount,
    });
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

  const handleDelete = async (id: string) => {
    await salesApi.deletePurchase(id);
    setDeleteConfirmId(null);
    loadSales();
  };

  const handleExport = () => {
    exportToCSV(sales, [
      { header: 'Дата', accessor: (s) => formatDateForExport(s.created_at) },
      { header: 'Телефон', accessor: (s) => s.client_phone },
      { header: 'Сумма', accessor: (s) => formatAmountForExport(s.amount) },
      { header: 'Источник', accessor: (s) => SOURCE_LABELS[s.source || 'manual'] || s.source || '' },
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
                    <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap hidden sm:table-cell">Источник</th>
                    <th className="py-2 px-3 text-center text-xs font-medium text-muted-foreground whitespace-nowrap">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSales.map((sale) => (
                    <tr key={sale.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 whitespace-nowrap text-xs">{formatDateTime(sale.created_at)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{sale.client_phone}</td>
                      <td className="py-2 px-3 text-left whitespace-nowrap font-medium text-green-600">{sale.amount} ₸</td>
                      <td className="py-2 px-3 whitespace-nowrap hidden sm:table-cell text-xs text-muted-foreground">
                        {SOURCE_LABELS[sale.source || 'manual'] || sale.source || '—'}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* Редактирование */}
                          <Dialog open={modalOpen && editingId === sale.id} onOpenChange={(open) => { if (!open) cancelEdit(); }}>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                title="Редактировать"
                                onClick={() => startEdit(sale)}
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
                              </div>
                              <DialogFooter className="mt-6 gap-2">
                                <DialogClose asChild>
                                  <Button variant="outline" onClick={cancelEdit}>Отмена</Button>
                                </DialogClose>
                                <Button onClick={() => saveEdit(sale.id)}>Сохранить</Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          {/* Удаление */}
                          <Dialog open={deleteConfirmId === sale.id} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                title="Удалить"
                                onClick={() => setDeleteConfirmId(sale.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-sm">
                              <DialogHeader>
                                <DialogTitle>Удалить продажу?</DialogTitle>
                              </DialogHeader>
                              <p className="text-sm text-muted-foreground mt-2">
                                {sale.client_phone} — {sale.amount} ₸
                              </p>
                              <DialogFooter className="mt-4 gap-2">
                                <DialogClose asChild>
                                  <Button variant="outline">Отмена</Button>
                                </DialogClose>
                                <Button variant="destructive" onClick={() => handleDelete(sale.id)}>
                                  Удалить
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
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
