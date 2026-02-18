import React, { useState, useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Copy, ChevronRight, ChevronLeft, Loader2, X, ZoomIn } from 'lucide-react';
import { facebookApi } from '@/services/facebookApi';
import { toast } from 'sonner';

interface FacebookManualConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onSkip?: () => void;
  showSkipButton?: boolean;
  demoMode?: boolean;
  accountId?: string; // UUID ad_accounts.id для мультиаккаунтного режима
}

const PARTNER_ID = '290181230529709';

// Скриншоты для инструкции
const INSTRUCTION_IMAGES = {
  step1: '/images/fb-connect/step1-settings.png',
  step2: '/images/fb-connect/step2-page-partner.png',
  step3: '/images/fb-connect/step3-id-company.png',
  step4: '/images/fb-connect/step4-full-access.png',
  step5: '/images/fb-connect/step5-ad-account.png',
  step6: '/images/fb-connect/step6-instagram.png',
  formHelper: '/images/fb-connect/step7-ids.png',
};

export function FacebookManualConnectModal({
  open,
  onOpenChange,
  onComplete,
  onSkip,
  showSkipButton = false,
  demoMode = false,
  accountId,
}: FacebookManualConnectModalProps) {
  const [part, setPart] = useState<'instruction' | 'form' | 'success'>('instruction');
  const [instructionStep, setInstructionStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    page_id: '',
    instagram_id: '',
    ad_account_id: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Fullscreen preview внутри DialogContent
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const TOTAL_INSTRUCTION_STEPS = 6;

  const instructionSteps = [
    {
      title: 'Шаг 1: Откройте настройки Business Portfolio',
      description: <>Зайдите в ваш <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">Business Portfolio</a> на Facebook и перейдите в раздел "Настройки" в левом нижнем углу.</>,
      image: INSTRUCTION_IMAGES.step1,
    },
    {
      title: 'Шаг 2: Выберите страницу и назначьте партнёра',
      description: 'В разделе "Аккаунты" → "Страницы" выберите Facebook страницу, связанную с вашим основным Instagram, и нажмите "Назначить партнёра".',
      image: INSTRUCTION_IMAGES.step2,
    },
    {
      title: 'Шаг 3: Выберите "ID компании"',
      description: 'В появившемся окне выберите способ назначения партнёра - "ID компании".',
      image: INSTRUCTION_IMAGES.step3,
    },
    {
      title: 'Шаг 4: Введите ID партнёра и выдайте полный доступ',
      description: 'Введите наш ID компании-партнёра и выберите "Полный доступ (инструменты для бизнеса и Facebook)" → "Всё (кроме ответственных действий)", затем нажмите "Назначить".',
      image: INSTRUCTION_IMAGES.step4,
      showPartnerId: true,
    },
    {
      title: 'Шаг 5: Повторите для рекламного аккаунта',
      description: 'Перейдите в раздел "Аккаунты" → "Рекламные аккаунты", выберите нужный рекламный кабинет и проделайте те же действия - "Назначить партнёра" → ID компании → полный доступ.',
      image: INSTRUCTION_IMAGES.step5,
    },
    {
      title: 'Шаг 6: Повторите для аккаунта Instagram',
      description: 'Перейдите в раздел "Аккаунты" → "Аккаунты Instagram", выберите нужный аккаунт и назначьте партнёра с полным доступом.',
      image: INSTRUCTION_IMAGES.step6,
    },
  ];

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.page_id.trim()) {
      newErrors.page_id = 'Page ID обязателен';
    }

    if (!formData.ad_account_id.trim()) {
      newErrors.ad_account_id = 'Ad Account ID обязателен';
    }

    // instagram_id необязателен — без него реклама не будет показываться в Instagram ленте

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);

    if (demoMode) {
      console.log('[FacebookManualConnectModal] DEMO MODE - Data would be sent:', {
        page_id: formData.page_id.trim(),
        instagram_id: formData.instagram_id.trim() || null,
        ad_account_id: formData.ad_account_id.trim(),
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      setPart('success');
      setLoading(false);
      return;
    }

    try {
      const result = await facebookApi.submitManualConnection({
        page_id: formData.page_id.trim(),
        instagram_id: formData.instagram_id.trim() || undefined,
        ad_account_id: formData.ad_account_id.trim(),
        account_id: accountId,
      });

      if (result.success) {
        setPart('success');
        setTimeout(() => {
          onComplete();
        }, 3000);
      } else {
        toast.error(result.error || 'Ошибка при отправке заявки');
      }
    } catch (error) {
      toast.error('Не удалось отправить заявку');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPartnerId = () => {
    navigator.clipboard.writeText(PARTNER_ID);
    toast.success('ID скопирован');
  };

  const handleSkip = () => {
    onSkip?.();
    onOpenChange(false);
  };

  const resetModal = useCallback(() => {
    setPart('instruction');
    setInstructionStep(1);
    setFormData({ page_id: '', instagram_id: '', ad_account_id: '' });
    setErrors({});
    setPreviewSrc(null);
  }, []);

  React.useEffect(() => {
    if (open) {
      resetModal();
    }
  }, [open, resetModal]);

  const currentInstruction = instructionSteps[instructionStep - 1];

  // Success Screen
  if (part === 'success') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md w-[95vw] p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Заявка отправлена!</h3>
            <p className="text-muted-foreground">
              Спасибо за предоставленные данные. Наши технические специалисты в ближайшее время проверят правильность подключения и вернутся к вам с обратной связью.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Part 1: Instruction Steps
  if (part === 'instruction') {
    const previewOpen = !!previewSrc;

    return (
      <>
        {/* ОСНОВНОЙ ДИАЛОГ */}
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            className="sm:max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto p-4 sm:p-6"
            onInteractOutside={(e) => {
              // Пока открыт превью — не даём Radix закрыть внешний диалог
              if (previewOpen) {
                e.preventDefault();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Подключение Facebook Ads</DialogTitle>
              <DialogDescription>
                Часть 1 из 2: Предоставление партнёрского доступа
              </DialogDescription>
            </DialogHeader>

            {/* Progress indicator */}
            <div className="flex items-center gap-1 mb-4">
              {Array.from({ length: TOTAL_INSTRUCTION_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i + 1 <= instructionStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            <div className="space-y-4">
              {/* Step Title */}
              <h3 className="font-semibold text-lg">{currentInstruction.title}</h3>

              {/* Step Description */}
              <p className="text-muted-foreground">{currentInstruction.description}</p>

              {/* Partner ID Block (only on step 4) */}
              {currentInstruction.showPartnerId && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 sm:p-4">
                  <p className="text-sm font-medium mb-2">ID компании-партнёра:</p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-background rounded border p-2 sm:p-3">
                    <code className="flex-1 text-base sm:text-lg font-mono font-bold break-all text-center sm:text-left">{PARTNER_ID}</code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyPartnerId}
                      className="shrink-0 w-full sm:w-auto"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Копировать
                    </Button>
                  </div>
                </div>
              )}

              {/* Screenshot - clickable to zoom */}
              <button
                type="button"
                className="w-full border rounded-lg overflow-hidden bg-muted/30 cursor-pointer group relative"
                onClick={() => setPreviewSrc(currentInstruction.image)}
              >
                <div className="aspect-video flex items-center justify-center text-muted-foreground relative">
                  <img
                    src={currentInstruction.image}
                    alt={currentInstruction.title}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).parentElement!.innerHTML = `
                        <div class="flex items-center justify-center h-full text-muted-foreground p-8">
                          <span class="text-center">Скриншот шага ${instructionStep}</span>
                        </div>
                      `;
                    }}
                  />
                  {/* Zoom hint overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 text-white px-3 py-2 rounded-lg flex items-center gap-2">
                      <ZoomIn className="h-4 w-4" />
                      <span className="text-sm">Увеличить</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
              {showSkipButton && (
                <Button variant="ghost" onClick={handleSkip} className="sm:mr-auto">
                  Настроить позже
                </Button>
              )}

              <div className="flex gap-2 w-full sm:w-auto">
                {instructionStep > 1 && (
                  <Button
                    variant="outline"
                    onClick={() => setInstructionStep(prev => prev - 1)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Назад
                  </Button>
                )}

                {instructionStep < TOTAL_INSTRUCTION_STEPS ? (
                  <Button
                    onClick={() => setInstructionStep(prev => prev + 1)}
                    className="flex-1 sm:flex-none"
                  >
                    Далее
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => setPart('form')}
                    className="flex-1 sm:flex-none"
                  >
                    Продолжить к вводу данных
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ВТОРОЙ ДИАЛОГ ДЛЯ FULLSCREEN ПРЕВЬЮ */}
        <DialogPrimitive.Root open={previewOpen} onOpenChange={(next) => !next && setPreviewSrc(null)}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-black/95" />
            <DialogPrimitive.Content className="fixed inset-0 z-[9999] flex items-center justify-center bg-transparent">
              <button
                type="button"
                className="absolute right-4 top-4 rounded-full bg-white/20 p-3 hover:bg-white/30 transition-colors z-10"
                onClick={() => setPreviewSrc(null)}
              >
                <X className="h-6 w-6 text-white" />
              </button>
              <img
                src={previewSrc || ''}
                alt="Увеличенный скриншот"
                className="max-h-[95vh] max-w-[95vw] object-contain"
              />
              <p className="absolute bottom-6 left-0 right-0 text-center text-white/70 text-sm">
                Нажмите в любом месте чтобы закрыть
              </p>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </>
    );
  }

  // Part 2: Form
  const previewOpen = !!previewSrc;

  return (
    <>
      {/* ОСНОВНОЙ ДИАЛОГ */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto p-4 sm:p-6"
          onInteractOutside={(e) => {
            // Пока открыт превью — не даём Radix закрыть внешний диалог
            if (previewOpen) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Подключение Facebook Ads</DialogTitle>
            <DialogDescription>
              Часть 2 из 2: Введите ID ваших объектов
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 sm:space-y-4 py-2">
            {/* Info block */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4 text-sm">
              <p className="text-blue-800 dark:text-blue-200">
                После того как вы предоставили партнёрский доступ, введите ID ваших объектов.
                Их можно найти в настройках Business Portfolio рядом с названием каждого объекта.
              </p>
            </div>

            {/* Screenshot - clickable to zoom */}
            <button
              type="button"
              className="w-full border rounded-lg overflow-hidden bg-muted/30 cursor-pointer group relative"
              onClick={() => setPreviewSrc(INSTRUCTION_IMAGES.formHelper)}
            >
              <div className="aspect-video flex items-center justify-center text-muted-foreground relative">
                <img
                  src={INSTRUCTION_IMAGES.formHelper}
                  alt="Где найти ID объектов"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.innerHTML = `
                      <div class="flex items-center justify-center h-full text-muted-foreground p-8">
                        <span class="text-center">Скриншот: где найти ID</span>
                      </div>
                    `;
                  }}
                />
                {/* Zoom hint overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 text-white px-3 py-2 rounded-lg flex items-center gap-2">
                    <ZoomIn className="h-4 w-4" />
                    <span className="text-sm">Увеличить</span>
                  </div>
                </div>
              </div>
            </button>

            {/* Form Fields */}
            <div className="space-y-3 sm:space-y-4">
              <div className="space-y-1.5 sm:space-y-2">
                <Label htmlFor="page_id" className="text-sm">
                  Facebook Page ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="page_id"
                  placeholder="123456789012345"
                  value={formData.page_id}
                  onChange={(e) => {
                    setFormData({ ...formData, page_id: e.target.value });
                    if (errors.page_id) setErrors({ ...errors, page_id: '' });
                  }}
                  className={errors.page_id ? 'border-red-500' : ''}
                />
                {errors.page_id && (
                  <p className="text-sm text-red-500">{errors.page_id}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  ID страницы Facebook, к которой вы предоставили доступ
                </p>
              </div>

              <div className="space-y-1.5 sm:space-y-2">
                <Label htmlFor="ad_account_id" className="text-sm">
                  Ad Account ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ad_account_id"
                  placeholder="act_123456789012345"
                  value={formData.ad_account_id}
                  onChange={(e) => {
                    setFormData({ ...formData, ad_account_id: e.target.value });
                    if (errors.ad_account_id) setErrors({ ...errors, ad_account_id: '' });
                  }}
                  className={errors.ad_account_id ? 'border-red-500' : ''}
                />
                {errors.ad_account_id && (
                  <p className="text-sm text-red-500">{errors.ad_account_id}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  ID рекламного кабинета (префикс act_ добавится автоматически если не указан)
                </p>
              </div>

              <div className="space-y-1.5 sm:space-y-2">
                <Label htmlFor="instagram_id" className="text-sm">
                  Instagram Account ID <span className="text-muted-foreground text-xs">(необязательно)</span>
                </Label>
                <Input
                  id="instagram_id"
                  placeholder="123456789012345"
                  value={formData.instagram_id}
                  onChange={(e) => {
                    setFormData({ ...formData, instagram_id: e.target.value });
                    if (errors.instagram_id) setErrors({ ...errors, instagram_id: '' });
                  }}
                  className={errors.instagram_id ? 'border-red-500' : ''}
                />
                {errors.instagram_id && (
                  <p className="text-sm text-red-500">{errors.instagram_id}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  ID аккаунта Instagram из раздела "Аккаунты Instagram". Без него реклама не будет показываться в Instagram ленте.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setPart('instruction')}
              className="sm:mr-auto w-full sm:w-auto order-2 sm:order-1"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Вернуться к инструкции
            </Button>

            <Button onClick={handleSubmit} disabled={loading} className="w-full sm:w-auto order-1 sm:order-2">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                'Отправить на проверку'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ВТОРОЙ ДИАЛОГ ДЛЯ FULLSCREEN ПРЕВЬЮ */}
      <DialogPrimitive.Root open={previewOpen} onOpenChange={(next) => !next && setPreviewSrc(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-black/95" />
          <DialogPrimitive.Content className="fixed inset-0 z-[9999] flex items-center justify-center bg-transparent">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-full bg-white/20 p-3 hover:bg-white/30 transition-colors z-10"
              onClick={() => setPreviewSrc(null)}
            >
              <X className="h-6 w-6 text-white" />
            </button>
            <img
              src={previewSrc || ''}
              alt="Увеличенный скриншот"
              className="max-h-[95vh] max-w-[95vw] object-contain"
            />
            <p className="absolute bottom-6 left-0 right-0 text-center text-white/70 text-sm">
              Нажмите в любом месте чтобы закрыть
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
