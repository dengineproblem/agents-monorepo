import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { DollarSign } from 'lucide-react';
import { salesApi } from '@/services/salesApi';

export function SaleUpload() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  // Форма добавления продажи
  const [saleForm, setSaleForm] = useState({
    client_phone: '',
    amount: ''
  });

  // Состояния для выбора кампании
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [existingCampaigns, setExistingCampaigns] = useState<Array<{id: string, name: string, creative_url?: string}>>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

  // Добавление продажи
  const handleSaleSubmit = async () => {
    if (!saleForm.client_phone || !saleForm.amount) {
      toast.error('Заполните все поля: телефон и сумма');
      return;
    }

    // Валидация номера телефона
    const cleanPhone = saleForm.client_phone.replace(/[\s\-\(\)\u200C\u200D\u200E\u200F\uFEFF]/g, '');
    let normalizedPhone = cleanPhone;
    
    // Убираем + если есть
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    // Если начинается с 8, заменяем на 7
    if (normalizedPhone.startsWith('8') && normalizedPhone.length === 11) {
      normalizedPhone = '7' + normalizedPhone.substring(1);
    }
    
    // Если начинается с 77 (12 цифр), убираем первую 7
    if (normalizedPhone.startsWith('77') && normalizedPhone.length === 12) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    const phoneRegex = /^7[0-9]{10}$/;
    if (!phoneRegex.test(normalizedPhone)) {
      toast.error('Введите корректный номер телефона в формате 77079808026');
      return;
    }

    // Валидация суммы
    const amount = Number(saleForm.amount);
    if (amount <= 0) {
      toast.error('Сумма должна быть больше 0');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const businessId = await salesApi.getCurrentUserBusinessId();
      if (!businessId) {
        toast.error('Business ID не найден. Обратитесь к администратору.');
        return;
      }

      // Добавляем продажу БЕЗ manual_source_id - система проверит есть ли лид
      await salesApi.addSale({
        client_phone: normalizedPhone,
        amount: amount,
        business_id: businessId
      });
      
      toast.success('Продажа успешно добавлена! 🎉');
      resetForm();
      
    } catch (error) {
      console.error('Ошибка добавления продажи:', error);
      console.log('🔍 Тип ошибки:', typeof error);
      console.log('🔍 error instanceof Error:', error instanceof Error);
      console.log('🔍 error.message:', error instanceof Error ? error.message : 'Нет message');
      
      // Проверяем нужно ли показать форму выбора кампании
      if (error instanceof Error && error.message.includes('не найден в базе лидов')) {
        console.log('✅ Показываем форму выбора кампании');
        const currentBusinessId = await salesApi.getCurrentUserBusinessId();
        if (currentBusinessId) {
          await loadExistingCampaigns(currentBusinessId);
          setShowCreateLead(true);
        }
        return;
      }
      
      let errorMessage = 'Не удалось добавить продажу. Попробуйте еще раз.';
      
      if (error instanceof Error) {
        if (error.message.includes('уже существует')) {
          errorMessage = 'Продажа для этого клиента уже существует в системе.';
        } else if (error.message.includes('Business ID')) {
          errorMessage = 'Ошибка авторизации. Попробуйте перезайти в систему.';
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Загрузка существующих кампаний
  const loadExistingCampaigns = async (businessId: string) => {
    setIsLoadingCampaigns(true);
    try {
      const campaigns = await salesApi.getExistingCampaigns(businessId);
      setExistingCampaigns(campaigns);
    } catch (error) {
      console.error('Ошибка загрузки кампаний:', error);
      setExistingCampaigns([]);
    } finally {
      setIsLoadingCampaigns(false);
    }
  };

  // Добавление продажи с выбранной кампанией
  const handleAddSaleWithCampaign = async () => {
    console.log('🎯 handleAddSaleWithCampaign вызван');
    console.log('🎯 selectedCampaignId:', selectedCampaignId);
    console.log('🎯 existingCampaigns:', existingCampaigns);
    
    if (!selectedCampaignId) {
      toast.error('Выберите кампанию');
      return;
    }

    const cleanPhone = saleForm.client_phone.replace(/[\s\-\(\)\u200C\u200D\u200E\u200F\uFEFF]/g, '');
    let normalizedPhone = cleanPhone;
    
    // Убираем + если есть
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    // Если начинается с 8, заменяем на 7
    if (normalizedPhone.startsWith('8') && normalizedPhone.length === 11) {
      normalizedPhone = '7' + normalizedPhone.substring(1);
    }
    
    // Если начинается с 77 (12 цифр), убираем первую 7
    if (normalizedPhone.startsWith('77') && normalizedPhone.length === 12) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    const amount = Number(saleForm.amount);

    // Получаем данные выбранной кампании
    const selectedCampaign = existingCampaigns.find(c => c.id === selectedCampaignId);
    console.log('🎯 selectedCampaign:', selectedCampaign);
    
    if (!selectedCampaign) {
      toast.error('Выбранная кампания не найдена');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const businessId = await salesApi.getCurrentUserBusinessId();
      if (!businessId) {
        toast.error('Business ID не найден. Обратитесь к администратору.');
        return;
      }

      // Добавляем продажу с указанной кампанией
      await salesApi.addSale({
        client_phone: normalizedPhone,
        amount: amount,
        business_id: businessId,
        manual_source_id: selectedCampaign.id,
        manual_creative_url: selectedCampaign.creative_url || ''
      });
      
      toast.success('Продажа и лид успешно добавлены! 🎉');
      resetForm();
      
    } catch (error) {
      console.error('Ошибка добавления продажи с кампанией:', error);
      toast.error('Не удалось добавить продажу. Попробуйте еще раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSaleForm({
      client_phone: '',
      amount: ''
    });
    setShowForm(false);
    setShowCreateLead(false);
    setSelectedCampaignId('');
    setExistingCampaigns([]);
  };

  return (
    <div>
      {!showForm ? (
        <Button
          variant="outline"
          onClick={() => setShowForm(true)}
          disabled={isSubmitting}
          className="w-full"
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Добавить продажу
        </Button>
      ) : (
        <div className="space-y-4 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-medium">Добавить продажу</h3>
          
          <div>
            <label className="block mb-1 font-medium text-sm">Номер телефона клиента *</label>
            <Input
              type="tel"
              placeholder="77079808026"
              value={saleForm.client_phone}
              onChange={(e) => setSaleForm(prev => ({ ...prev, client_phone: e.target.value }))}
              disabled={isSubmitting}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Введите номер в формате: 77079808026 (11 цифр, начинается с 7)
            </p>
          </div>

          <div>
            <label className="block mb-1 font-medium text-sm">Сумма продажи (₸) *</label>
            <Input
              type="number"
              min="1"
              placeholder="15000"
              value={saleForm.amount}
              onChange={(e) => setSaleForm(prev => ({ ...prev, amount: e.target.value }))}
              disabled={isSubmitting}
              className="w-full"
            />
          </div>

          {/* Форма выбора кампании - показывается если лид не найден */}
          {showCreateLead ? (
            <div className="space-y-4 p-4 border rounded-lg bg-yellow-50 border-yellow-200">
              <div className="flex items-center gap-2">
                <span className="text-yellow-600 text-lg">⚠️</span>
                <h4 className="font-medium text-yellow-800">Лид не найден</h4>
              </div>
              <p className="text-sm text-yellow-700">
                Клиент с номером {saleForm.client_phone} не найден в базе лидов. Выберите кампанию, с которой он пришел.
              </p>

              <div>
                <label className="block mb-2 font-medium text-sm">Выберите кампанию</label>
                {isLoadingCampaigns ? (
                  <div className="py-4 text-center text-gray-500">Загружаем кампании...</div>
                ) : existingCampaigns.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {existingCampaigns.map((campaign) => (
                      <label key={campaign.id} className="flex items-start gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="campaign"
                          value={campaign.id}
                          checked={selectedCampaignId === campaign.id}
                          onChange={(e) => setSelectedCampaignId(e.target.value)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="font-medium">{campaign.name}</div>
                          <div className="text-xs text-gray-500">ID: {campaign.id}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-gray-500">Кампании не найдены</div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                <Button 
                  onClick={handleAddSaleWithCampaign}
                  disabled={isSubmitting || !selectedCampaignId}
                  className="w-full sm:w-auto"
                >
                  <DollarSign className="mr-2 h-4 w-4" />
                  {isSubmitting ? 'Добавляется...' : 'Добавить продажу'}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowCreateLead(false)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
              <Button 
                onClick={handleSaleSubmit} 
                disabled={isSubmitting || !saleForm.client_phone || !saleForm.amount}
                className="w-full sm:w-auto"
              >
                <DollarSign className="mr-2 h-4 w-4" />
                {isSubmitting ? 'Добавляется...' : 'Добавить продажу'}
              </Button>
              
              <Button 
                variant="outline"
                onClick={resetForm}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                Отмена
              </Button>
            </div>
          )}

          {isSubmitting && (
            <div className="mt-4 p-3 bg-gradient-to-r from-gray-50 to-slate-50 border border-gray-200 rounded-lg">
              <div className="flex items-start gap-2">
                <span className="text-gray-600 text-lg">💰</span>
                <div className="text-sm text-gray-700">
                  <div className="font-medium mb-1">Сохраняем продажу...</div>
                  <div>
                    Данные о продаже добавляются в систему для анализа ROI.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 