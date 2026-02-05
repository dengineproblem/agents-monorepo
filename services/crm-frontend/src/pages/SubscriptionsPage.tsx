import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Link2, Loader2, PlayCircle, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { consultationService } from '@/services/consultationService';
import { subscriptionApi } from '@/services/subscriptionApi';
import {
  SubscriptionProduct,
  SubscriptionSale,
  SubscriptionUserSearchItem,
  PhoneUserLink
} from '@/types/subscription';
import { toast } from 'sonner';

interface ConsultantOption {
  id: string;
  name: string;
}

type CreateSaleKind = 'subscription' | 'custom';

const SALE_STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'pending_link', label: 'Ожидает привязки' },
  { value: 'linked', label: 'Привязана' },
  { value: 'applied', label: 'Применена' },
  { value: 'cancelled', label: 'Отменена' }
];

const SALE_KIND_OPTIONS = [
  { value: 'all', label: 'Все типы' },
  { value: 'subscription', label: 'Подписка' },
  { value: 'custom', label: 'Кастом' }
];

export function SubscriptionsPage() {
  const { user } = useAuth();
  const isTechAdmin = user?.is_tech_admin === true;

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningJob, setIsRunningJob] = useState(false);
  const [cancelingSaleId, setCancelingSaleId] = useState<string | null>(null);

  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [sales, setSales] = useState<SubscriptionSale[]>([]);
  const [appliedSubscriptions, setAppliedSubscriptions] = useState<SubscriptionSale[]>([]);
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');

  const [saleKind, setSaleKind] = useState<CreateSaleKind>('subscription');
  const [consultantId, setConsultantId] = useState('none');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [productId, setProductId] = useState('');
  const [customProductName, setCustomProductName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customMonths, setCustomMonths] = useState('');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [comment, setComment] = useState('');

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [saleToLink, setSaleToLink] = useState<SubscriptionSale | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<SubscriptionUserSearchItem[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [persistLink, setPersistLink] = useState(true);
  const [linkNotes, setLinkNotes] = useState('');
  const [searchingUsers, setSearchingUsers] = useState(false);

  const [phoneLookup, setPhoneLookup] = useState('');
  const [phoneLinks, setPhoneLinks] = useState<PhoneUserLink[]>([]);
  const [normalizedPhone, setNormalizedPhone] = useState('');

  const [manualUserQuery, setManualUserQuery] = useState('');
  const [manualUserResults, setManualUserResults] = useState<SubscriptionUserSearchItem[]>([]);
  const [manualUserId, setManualUserId] = useState('');
  const [manualMonths, setManualMonths] = useState('1');
  const [manualAmount, setManualAmount] = useState('');
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualComment, setManualComment] = useState('');

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId) || null,
    [products, productId]
  );

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadSales();
  }, [search, statusFilter, kindFilter]);

  const loadInitialData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);
      const [productsData, salesData, consultantsData, appliedData] = await Promise.all([
        subscriptionApi.getProducts(false),
        subscriptionApi.getSales(),
        consultationService.getConsultants(user.id),
        subscriptionApi.getSales({
          status: 'applied',
          sale_kind: 'subscription',
          include_user: true,
          limit: 200
        })
      ]);

      setProducts(productsData);
      setSales(salesData.sales);
      setAppliedSubscriptions(appliedData.sales);
      setConsultants(
        consultantsData.map((consultant) => ({
          id: consultant.id,
          name: consultant.name
        }))
      );

      const firstProduct = productsData[0];
      if (firstProduct) {
        setProductId(firstProduct.id);
      }
    } catch (error: any) {
      toast.error(error.message || 'Не удалось загрузить данные подписок');
    } finally {
      setLoading(false);
    }
  };

  const loadSales = async () => {
    try {
      const response = await subscriptionApi.getSales({
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        sale_kind: kindFilter === 'all' ? undefined : kindFilter
      });
      setSales(response.sales);
    } catch (error: any) {
      toast.error(error.message || 'Не удалось загрузить продажи подписок');
    }
  };

  const loadAppliedSubscriptions = async () => {
    try {
      const response = await subscriptionApi.getSales({
        status: 'applied',
        sale_kind: 'subscription',
        include_user: true,
        limit: 200
      });
      setAppliedSubscriptions(response.sales);
    } catch (error: any) {
      toast.error(error.message || 'Не удалось загрузить список подписок');
    }
  };

  const resetCreateForm = () => {
    setClientName('');
    setClientPhone('');
    setCustomProductName('');
    setCustomAmount('');
    setCustomMonths('');
    setComment('');
    setSaleDate(new Date().toISOString().slice(0, 10));
    setSaleKind('subscription');
    if (products[0]) {
      setProductId(products[0].id);
    }
  };

  const handleCreateSale = async () => {
    if (!clientPhone.trim()) {
      toast.error('Укажите телефон клиента');
      return;
    }

    if (saleKind === 'subscription' && !productId) {
      toast.error('Выберите подписочный SKU');
      return;
    }

    if (saleKind === 'custom') {
      if (!customProductName.trim()) {
        toast.error('Укажите название кастомного продукта');
        return;
      }
      if (!customAmount || Number(customAmount) <= 0) {
        toast.error('Укажите сумму для кастомной продажи');
        return;
      }
    }

    try {
      setIsSaving(true);

      await subscriptionApi.createSale({
        consultant_id: consultantId === 'none' ? undefined : consultantId,
        client_name: clientName.trim() || undefined,
        client_phone: clientPhone.trim(),
        product_id: saleKind === 'subscription' ? productId : undefined,
        custom_product_name: saleKind === 'custom' ? customProductName.trim() : undefined,
        amount: saleKind === 'custom' ? Number(customAmount) : undefined,
        months: saleKind === 'custom' && customMonths ? Number(customMonths) : undefined,
        sale_date: saleDate,
        comment: comment.trim() || undefined
      });

      toast.success('Продажа добавлена');
      resetCreateForm();
      await loadSales();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось добавить продажу');
    } finally {
      setIsSaving(false);
    }
  };

  const openLinkDialog = (sale: SubscriptionSale) => {
    setSaleToLink(sale);
    setLinkDialogOpen(true);
    setUserSearchQuery(sale.client_phone || '');
    setUserSearchResults([]);
    setSelectedUserId('');
    setPersistLink(true);
    setLinkNotes('');
  };

  const searchUsers = async () => {
    if (!userSearchQuery.trim()) {
      toast.error('Введите запрос для поиска пользователя');
      return;
    }

    try {
      setSearchingUsers(true);
      const results = await subscriptionApi.searchUsers(userSearchQuery.trim(), 30);
      setUserSearchResults(results);
      if (results.length === 0) {
        toast.message('Пользователи не найдены');
      }
    } catch (error: any) {
      toast.error(error.message || 'Не удалось выполнить поиск пользователя');
    } finally {
      setSearchingUsers(false);
    }
  };

  const confirmLinkSale = async () => {
    if (!saleToLink) return;

    if (!selectedUserId) {
      toast.error('Выберите пользователя для привязки');
      return;
    }

    try {
      setIsSaving(true);
      await subscriptionApi.linkSaleToUser(saleToLink.id, {
        user_account_id: selectedUserId,
        persist_link: persistLink,
        notes: linkNotes.trim() || undefined
      });

      toast.success('Продажа привязана к пользователю');
      setLinkDialogOpen(false);
      setSaleToLink(null);
      await loadSales();
      await loadAppliedSubscriptions();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось привязать продажу');
    } finally {
      setIsSaving(false);
    }
  };

  const applySale = async (sale: SubscriptionSale) => {
    try {
      setIsSaving(true);
      await subscriptionApi.applySale(sale.id);
      toast.success('Подписка применена к пользователю');
      await loadSales();
      await loadAppliedSubscriptions();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось применить подписку');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelSale = async (sale: SubscriptionSale) => {
    if (!isTechAdmin) return;
    const confirmed = window.confirm(
      sale.status === 'applied'
        ? 'Отменить продажу? Это не откатит срок подписки автоматически. При необходимости скорректируйте срок вручную.'
        : 'Отменить продажу?'
    );
    if (!confirmed) return;

    try {
      setCancelingSaleId(sale.id);
      const result = await subscriptionApi.cancelSale(sale.id);
      toast.success('Продажа отменена');
      if (result.warning) {
        toast.message(result.warning);
      }
      await loadSales();
      await loadAppliedSubscriptions();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось отменить продажу');
    } finally {
      setCancelingSaleId(null);
    }
  };

  const runSweepJob = async () => {
    try {
      setIsRunningJob(true);
      const response = await subscriptionApi.runJobs();
      toast.success(
        `Sweep завершен: напомн. ${response.stats.remindersSent}, отключено ${response.stats.deactivatedUsers}`
      );
      await loadSales();
      await loadAppliedSubscriptions();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось запустить sweep');
    } finally {
      setIsRunningJob(false);
    }
  };

  const lookupPhoneLinks = async () => {
    if (!phoneLookup.trim()) {
      toast.error('Введите номер телефона для поиска');
      return;
    }

    try {
      const response = await subscriptionApi.getPhoneLinks(phoneLookup.trim());
      setPhoneLinks(response.links);
      setNormalizedPhone(response.normalized_phone);
    } catch (error: any) {
      toast.error(error.message || 'Не удалось получить связи phone -> user');
    }
  };

  const searchManualUsers = async () => {
    if (!manualUserQuery.trim()) {
      toast.error('Введите запрос для поиска пользователя');
      return;
    }

    try {
      setSearchingUsers(true);
      const results = await subscriptionApi.searchUsers(manualUserQuery.trim(), 30);
      setManualUserResults(results);
      if (results.length === 0) {
        toast.message('Пользователи не найдены');
      }
    } catch (error: any) {
      toast.error(error.message || 'Не удалось выполнить поиск пользователя');
    } finally {
      setSearchingUsers(false);
    }
  };

  const applyManualSubscription = async () => {
    if (!manualUserId) {
      toast.error('Выберите пользователя');
      return;
    }

    if (!manualMonths || Number(manualMonths) <= 0) {
      toast.error('Укажите количество месяцев');
      return;
    }

    if (!manualAmount || Number(manualAmount) < 0) {
      toast.error('Укажите сумму');
      return;
    }

    try {
      setIsSaving(true);
      await subscriptionApi.setUserSubscription(manualUserId, {
        months: Number(manualMonths),
        amount: Number(manualAmount),
        comment: manualComment.trim() || undefined,
        start_date: manualStartDate || undefined
      });
      toast.success('Подписка установлена вручную');
      setManualComment('');
      await loadSales();
      await loadAppliedSubscriptions();
    } catch (error: any) {
      toast.error(error.message || 'Не удалось установить подписку');
    } finally {
      setIsSaving(false);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'applied') return <Badge className="bg-green-600">Применена</Badge>;
    if (status === 'linked') return <Badge className="bg-blue-600">Привязана</Badge>;
    if (status === 'pending_link') return <Badge variant="secondary">Ожидает привязки</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  const kindBadge = (kind: string) => {
    if (kind === 'subscription') return <Badge>Подписка</Badge>;
    return <Badge variant="outline">Кастом</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Подписки и продажи</h1>
          <p className="text-sm text-muted-foreground">CRM каталог подписок, продажи, привязка phone -&gt; user и применение тарифов</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void loadSales();
              void loadAppliedSubscriptions();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
          {isTechAdmin && (
            <Button variant="default" onClick={runSweepJob} disabled={isRunningJob}>
              {isRunningJob ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4 mr-2" />
              )}
              Запустить проверку
            </Button>
          )}
        </div>
      </div>

      {!isTechAdmin && (
        <Card className="border-yellow-500/30">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Режим просмотра: действия привязки и применения подписки доступны только tech admin.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Добавить продажу</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <Label>Консультант</Label>
              <Select value={consultantId} onValueChange={setConsultantId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не привязан</SelectItem>
                  {consultants.map((consultant) => (
                    <SelectItem key={consultant.id} value={consultant.id}>
                      {consultant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Тип продажи</Label>
              <Select value={saleKind} onValueChange={(value: CreateSaleKind) => setSaleKind(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscription">Подписка</SelectItem>
                  <SelectItem value="custom">Кастом</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Дата продажи</Label>
              <Input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
            </div>

            <div>
              <Label>Телефон клиента</Label>
              <Input value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} placeholder="+7..." />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Имя клиента</Label>
              <Input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Необязательно" />
            </div>
            <div>
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Заметка к продаже" rows={1} />
            </div>
          </div>

          {saleKind === 'subscription' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>SKU подписки</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите продукт" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.months}м / {product.price.toLocaleString('ru-RU')} {product.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                {selectedProduct ? (
                  <>
                    Будет создана продажа на <span className="font-medium text-foreground">{selectedProduct.months} мес</span>
                    {' '}за <span className="font-medium text-foreground">{selectedProduct.price.toLocaleString('ru-RU')} {selectedProduct.currency}</span>
                  </>
                ) : (
                  'Выберите SKU'
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Название кастомного продукта</Label>
                <Input
                  value={customProductName}
                  onChange={(event) => setCustomProductName(event.target.value)}
                  placeholder="Например: Консультация"
                />
              </div>
              <div>
                <Label>Сумма</Label>
                <Input
                  type="number"
                  min={0}
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Месяцев (опционально)</Label>
                <Input
                  type="number"
                  min={1}
                  value={customMonths}
                  onChange={(event) => setCustomMonths(event.target.value)}
                  placeholder="Если нужно применять как подписку вручную"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleCreateSale} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Добавить продажу
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Подписки пользователей</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Месяцы</TableHead>
                  <TableHead>Дата применения</TableHead>
                  <TableHead>Срок до</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appliedSubscriptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Активные подписки не найдены
                    </TableCell>
                  </TableRow>
                )}

                {appliedSubscriptions.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <div className="text-sm">
                        <div>{sale.user_accounts?.username || sale.user_account_id || '—'}</div>
                        <div className="text-muted-foreground text-xs font-mono">{sale.user_account_id || '—'}</div>
                      </div>
                    </TableCell>
                    <TableCell>{sale.client_phone}</TableCell>
                    <TableCell>{sale.months || '-'}</TableCell>
                    <TableCell>{sale.applied_at ? sale.applied_at.slice(0, 10) : '-'}</TableCell>
                    <TableCell>{sale.user_accounts?.tarif_expires || '-'}</TableCell>
                    <TableCell>{statusBadge(sale.status)}</TableCell>
                    <TableCell className="text-right">
                      {isTechAdmin && sale.status !== 'cancelled' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void cancelSale(sale)}
                          disabled={cancelingSaleId === sale.id}
                        >
                          {cancelingSaleId === sale.id ? 'Отмена...' : 'Отменить'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Отмена продажи не откатывает срок подписки автоматически. Для корректировки используйте «Ручную установку подписки».
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Продажи подписок</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по имени/телефону"
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALE_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALE_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => {
                void loadSales();
                void loadAppliedSubscriptions();
              }}
            >
              Обновить список
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Продукт</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Продажи не найдены
                    </TableCell>
                  </TableRow>
                )}

                {sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>{sale.sale_date}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{sale.client_name || 'Без имени'}</div>
                        <div className="text-muted-foreground">{sale.client_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>{kindBadge(sale.sale_kind)}</TableCell>
                    <TableCell>
                      {sale.sale_kind === 'subscription'
                        ? `${sale.months || '-'} мес (SKU)`
                        : sale.custom_product_name || 'Кастом'}
                    </TableCell>
                    <TableCell>{sale.amount.toLocaleString('ru-RU')} {sale.currency}</TableCell>
                    <TableCell>{statusBadge(sale.status)}</TableCell>
                    <TableCell className="font-mono text-xs">{sale.user_account_id || '-'}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {isTechAdmin && sale.status !== 'applied' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openLinkDialog(sale)}
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            Привязать
                          </Button>
                        )}

                        {isTechAdmin && sale.sale_kind === 'subscription' && sale.user_account_id && sale.status !== 'applied' && (
                          <Button
                            size="sm"
                            onClick={() => void applySale(sale)}
                            disabled={isSaving}
                          >
                            Применить
                          </Button>
                        )}

                        {isTechAdmin && sale.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void cancelSale(sale)}
                            disabled={cancelingSaleId === sale.id}
                          >
                            {cancelingSaleId === sale.id ? 'Отмена...' : 'Отменить'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Проверка phone → user links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={phoneLookup}
              onChange={(event) => setPhoneLookup(event.target.value)}
              placeholder="Введите телефон"
            />
            <Button variant="outline" onClick={() => void lookupPhoneLinks()}>
              Найти
            </Button>
          </div>

          {normalizedPhone && (
            <div className="text-sm text-muted-foreground">Нормализованный телефон: {normalizedPhone}</div>
          )}

          <div className="space-y-2">
            {phoneLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Связи не найдены</p>
            ) : (
              phoneLinks.map((link) => (
                <div key={link.id} className="rounded-md border p-3 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-mono">{link.user_account_id}</div>
                    <div className="text-muted-foreground">{link.notes || 'Без заметок'}</div>
                  </div>
                  {link.active ? <Badge>active</Badge> : <Badge variant="outline">inactive</Badge>}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {isTechAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Ручная установка подписки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={manualUserQuery}
                onChange={(event) => setManualUserQuery(event.target.value)}
                placeholder="username / telegram_id"
              />
              <Button variant="outline" onClick={() => void searchManualUsers()} disabled={searchingUsers}>
                {searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Искать'}
              </Button>
            </div>

            <div className="max-h-64 overflow-auto space-y-2">
              {manualUserResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">Найдите и выберите пользователя</p>
              ) : (
                manualUserResults.map((result) => (
                  <button
                    type="button"
                    key={result.id}
                    className={`w-full text-left rounded-md border p-3 transition ${manualUserId === result.id ? 'border-primary bg-primary/5' : ''}`}
                    onClick={() => setManualUserId(result.id)}
                  >
                    <div className="font-medium">{result.username}</div>
                    <div className="font-mono text-xs text-muted-foreground">{result.id}</div>
                  </button>
                ))
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Месяцев</Label>
                <Input type="number" min={1} value={manualMonths} onChange={(event) => setManualMonths(event.target.value)} />
              </div>
              <div>
                <Label>Сумма</Label>
                <Input type="number" min={0} value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} />
              </div>
              <div>
                <Label>Старт (опционально)</Label>
                <Input type="date" value={manualStartDate} onChange={(event) => setManualStartDate(event.target.value)} />
              </div>
              <div>
                <Label>Комментарий</Label>
                <Input value={manualComment} onChange={(event) => setManualComment(event.target.value)} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void applyManualSubscription()} disabled={isSaving || !manualUserId}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Установить подписку
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Привязка продажи к пользователю</DialogTitle>
            <DialogDescription>
              Выберите ровно одного пользователя для продажи {saleToLink?.client_phone}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.target.value)}
                placeholder="username / telegram_id"
              />
              <Button variant="outline" onClick={() => void searchUsers()} disabled={searchingUsers}>
                {searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Искать'}
              </Button>
            </div>

            <div className="max-h-72 overflow-auto space-y-2">
              {userSearchResults.length === 0 && (
                <p className="text-sm text-muted-foreground">Выполните поиск и выберите пользователя</p>
              )}

              {userSearchResults.map((result) => (
                <button
                  type="button"
                  key={result.id}
                  onClick={() => setSelectedUserId(result.id)}
                  className={`w-full text-left rounded-md border p-3 transition ${selectedUserId === result.id ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{result.username}</div>
                      <div className="font-mono text-xs text-muted-foreground">{result.id}</div>
                      <div className="text-xs text-muted-foreground">
                        tarif: {result.tarif || '-'} / expires: {result.tarif_expires || '-'}
                      </div>
                    </div>
                    <Badge variant={result.is_active ? 'default' : 'destructive'}>
                      {result.is_active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={persistLink}
                onCheckedChange={(checked) => setPersistLink(Boolean(checked))}
                id="persist-link"
              />
                <Label htmlFor="persist-link">Сохранить phone -&gt; user связь</Label>
            </div>

            <div>
              <Label>Заметка</Label>
              <Textarea value={linkNotes} onChange={(event) => setLinkNotes(event.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => void confirmLinkSale()} disabled={isSaving || !selectedUserId}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
