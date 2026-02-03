import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DollarSign, Plus, Pencil, Trash2, TrendingUp, Target, ShoppingBag, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { salesApi } from '@/services/salesApi';
import { Sale, SalesStats, ChartDataPoint } from '@/types/sales';
import { toast } from 'sonner';

export function SalesTab() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const [sales, setSales] = useState<Sale[]>([]);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [searchTerm, setSearchTerm] = useState('');
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month'>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Модальные окна
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);

  // Форма добавления/редактирования
  const [formData, setFormData] = useState({
    lead_id: '',
    amount: '',
    product_name: '',
    sale_date: new Date().toISOString().split('T')[0],
    comment: ''
  });

  // Загрузка данных
  useEffect(() => {
    loadData();
  }, [searchTerm, dateFrom, dateTo]);

  useEffect(() => {
    loadChartData();
  }, [chartPeriod]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Загружаем продажи
      const salesResponse = await salesApi.getSales({
        consultantId,
        search: searchTerm || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setSales(salesResponse.sales);

      // Загружаем статистику
      const statsData = await salesApi.getStats({ consultantId });
      setStats(statsData);
    } catch (error: any) {
      console.error('Failed to load sales data:', error);
      toast.error('Не удалось загрузить данные о продажах');
    } finally {
      setLoading(false);
    }
  };

  const loadChartData = async () => {
    try {
      const data = await salesApi.getChartData({
        consultantId,
        period: chartPeriod
      });
      setChartData(data);
    } catch (error: any) {
      console.error('Failed to load chart data:', error);
    }
  };

  const handleAddSale = async () => {
    try {
      await salesApi.createSale({
        lead_id: formData.lead_id,
        amount: parseFloat(formData.amount),
        product_name: formData.product_name,
        sale_date: formData.sale_date,
        comment: formData.comment || undefined
      }, consultantId);

      toast.success('Продажа успешно добавлена');
      setIsAddDialogOpen(false);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Failed to create sale:', error);
      toast.error(error.message || 'Не удалось добавить продажу');
    }
  };

  const handleUpdateSale = async () => {
    if (!editingSale) return;

    try {
      await salesApi.updateSale(editingSale.id, {
        amount: formData.amount ? parseFloat(formData.amount) : undefined,
        product_name: formData.product_name || undefined,
        sale_date: formData.sale_date || undefined,
        comment: formData.comment || undefined
      }, consultantId);

      toast.success('Продажа успешно обновлена');
      setIsEditDialogOpen(false);
      setEditingSale(null);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Failed to update sale:', error);
      toast.error(error.message || 'Не удалось обновить продажу');
    }
  };

  const handleDeleteSale = async () => {
    if (!saleToDelete) return;

    try {
      await salesApi.deleteSale(saleToDelete.id, consultantId);
      toast.success('Продажа успешно удалена');
      setDeleteConfirmOpen(false);
      setSaleToDelete(null);
      loadData();
    } catch (error: any) {
      console.error('Failed to delete sale:', error);
      toast.error(error.message || 'Не удалось удалить продажу');
    }
  };

  const openEditDialog = (sale: Sale) => {
    setEditingSale(sale);
    setFormData({
      lead_id: '',
      amount: sale.amount.toString(),
      product_name: sale.product_name || '',
      sale_date: sale.purchase_date,
      comment: sale.comment || ''
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (sale: Sale) => {
    setSaleToDelete(sale);
    setDeleteConfirmOpen(true);
  };

  const resetForm = () => {
    setFormData({
      lead_id: '',
      amount: '',
      product_name: '',
      sale_date: new Date().toISOString().split('T')[0],
      comment: ''
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-KZ', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Статистика */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Продаж в месяце</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sales_count || 0}</div>
            <p className="text-xs text-muted-foreground">
              Всего: {stats?.total_sales || 0} продаж
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Сумма продаж</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats?.total_amount || 0)}</div>
            <p className="text-xs text-muted-foreground">
              За текущий месяц
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Прогресс к плану</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.plan_amount ? `${stats.progress_percent.toFixed(1)}%` : 'Нет плана'}
            </div>
            {stats?.plan_amount ? (
              <p className="text-xs text-muted-foreground">
                План: {formatCurrency(stats.plan_amount)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Установите план продаж
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* График */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Динамика продаж
            </CardTitle>
            <Select
              value={chartPeriod}
              onValueChange={(value: 'week' | 'month') => setChartPeriod(value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Неделя</SelectItem>
                <SelectItem value="month">Месяц</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getDate()}/${date.getMonth() + 1}`;
                  }}
                />
                <YAxis />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => formatDate(label)}
                />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#8884d8"
                  strokeWidth={2}
                  name="Сумма продаж"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Нет данных для отображения
            </div>
          )}
        </CardContent>
      </Card>

      {/* Фильтры и кнопка добавления */}
      <Card>
        <CardHeader>
          <CardTitle>Продажи</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени/телефону..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
              placeholder="Дата от"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
              placeholder="Дата до"
            />
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Добавить продажу
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить продажу</DialogTitle>
                  <DialogDescription>
                    Заполните информацию о новой продаже
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="lead_id">ID лида</Label>
                    <Input
                      id="lead_id"
                      value={formData.lead_id}
                      onChange={(e) => setFormData({ ...formData, lead_id: e.target.value })}
                      placeholder="UUID лида"
                    />
                  </div>
                  <div>
                    <Label htmlFor="amount">Сумма (KZT)</Label>
                    <Input
                      id="amount"
                      type="number"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="100000"
                    />
                  </div>
                  <div>
                    <Label htmlFor="product_name">Название продукта/услуги</Label>
                    <Input
                      id="product_name"
                      value={formData.product_name}
                      onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                      placeholder="Консультация Premium"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sale_date">Дата продажи</Label>
                    <Input
                      id="sale_date"
                      type="date"
                      value={formData.sale_date}
                      onChange={(e) => setFormData({ ...formData, sale_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="comment">Комментарий (опционально)</Label>
                    <Textarea
                      id="comment"
                      value={formData.comment}
                      onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                      placeholder="Дополнительная информация..."
                      rows={3}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={handleAddSale}>Добавить</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Таблица продаж */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Продукт/Услуга</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Продаж пока нет
                    </TableCell>
                  </TableRow>
                ) : (
                  sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell>{formatDate(sale.purchase_date)}</TableCell>
                      <TableCell>{sale.client_phone}</TableCell>
                      <TableCell>{sale.product_name || '—'}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(sale.amount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(sale)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(sale)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Диалог редактирования */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать продажу</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit_amount">Сумма (KZT)</Label>
              <Input
                id="edit_amount"
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_product_name">Название продукта/услуги</Label>
              <Input
                id="edit_product_name"
                value={formData.product_name}
                onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_sale_date">Дата продажи</Label>
              <Input
                id="edit_sale_date"
                type="date"
                value={formData.sale_date}
                onChange={(e) => setFormData({ ...formData, sale_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_comment">Комментарий</Label>
              <Textarea
                id="edit_comment"
                value={formData.comment}
                onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleUpdateSale}>Сохранить</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог удаления */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить продажу?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Продажа будет удалена навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSale} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
