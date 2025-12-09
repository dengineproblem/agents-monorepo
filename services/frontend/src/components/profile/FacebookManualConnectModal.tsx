import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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

// Компонент для отображения скриншота на весь экран
const FullscreenImageOverlay = ({
  src,
  onClose
}: {
  src: string;
  onClose: () => void;
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Обработка Escape - перехватываем до Dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Обработка клика - закрываем только fullscreen, не даём пробрасываться к Dialog
  const handleOverlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    // Не закрываем если кликнули по картинке
    if (target.tagName === 'IMG') return;
    onCloseRef.current();
  };

  // Блокируем pointerdown чтобы Radix Dialog не перехватывал
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      id="fullscreen-image-overlay"
      className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center cursor-pointer"
      onClick={handleOverlayClick}
      onPointerDown={handlePointerDown}
    >
      <button
        type="button"
        className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-md p-2 z-10"
        onClick={(e) => {
          e.stopPropagation();
          onCloseRef.current();
        }}
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={src}
        alt="Скриншот"
        className="max-w-[95vw] max-h-[95vh] object-contain cursor-default"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-4 text-white/70 text-sm pointer-events-none">
        Нажмите в любом месте или Escape чтобы закрыть
      </p>
    </div>,
    document.body
  );
};

interface FacebookManualConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onSkip?: () => void;
  showSkipButton?: boolean;
  demoMode?: boolean;
}

const PARTNER_ID = '1003576504991471';

// Скриншоты для инструкции
const INSTRUCTION_IMAGES = {
  step1: '/images/fb-connect/step1-settings.png',
  step2: '/images/fb-connect/step2-page-partner.png',
  step3: '/images/fb-connect/step3-id-company.png',
  step4: '/images/fb-connect/step4-full-access.png',
  step5: '/images/fb-connect/step5-ad-account.png',
  step6: '/images/fb-connect/step6-instagram.png',
  formHelper: '/images/fb-connect/step7-ids.png', // Скриншот для формы - где искать ID
};

export function FacebookManualConnectModal({
  open,
  onOpenChange,
  onComplete,
  onSkip,
  showSkipButton = false,
  demoMode = false,
}: FacebookManualConnectModalProps) {
  // Часть 1: Инструкция (шаги 1-6), Часть 2: Ввод данных
  const [part, setPart] = useState<'instruction' | 'form' | 'success'>('instruction');
  const [instructionStep, setInstructionStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    page_id: '',
    instagram_id: '',
    ad_account_id: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Обёртка для onOpenChange - блокируем закрытие Dialog если открыт fullscreen
  const handleDialogOpenChange = useCallback((newOpen: boolean) => {
    // Если пытаемся закрыть Dialog, но fullscreen открыт - игнорируем
    if (!newOpen && fullscreenImage) {
      return;
    }
    onOpenChange(newOpen);
  }, [fullscreenImage, onOpenChange]);

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

    if (!formData.instagram_id.trim()) {
      newErrors.instagram_id = 'Instagram ID обязателен';
    }

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

  const resetModal = () => {
    setPart('instruction');
    setInstructionStep(1);
    setFormData({ page_id: '', instagram_id: '', ad_account_id: '' });
    setErrors({});
    setFullscreenImage(null);
  };

  React.useEffect(() => {
    if (open) {
      resetModal();
    }
  }, [open]);

  const currentInstruction = instructionSteps[instructionStep - 1];

  // Success Screen
  if (part === 'success') {
    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
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
    return (
      <>
        {/* Fullscreen Image Overlay - рендерится через портал в body */}
        {fullscreenImage && (
          <FullscreenImageOverlay
            src={fullscreenImage}
            onClose={() => setFullscreenImage(null)}
          />
        )}

        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
          <DialogContent
            className="sm:max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] p-4 sm:p-6"
            onPointerDownOutside={(e) => {
              // Блокируем закрытие если fullscreen открыт
              if (fullscreenImage) {
                e.preventDefault();
              }
            }}
            onInteractOutside={(e) => {
              if (fullscreenImage) {
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

              {/* Screenshot - clickable to open fullscreen */}
              <div
                className="border rounded-lg overflow-hidden bg-muted/30 cursor-pointer group relative"
                onClick={() => setFullscreenImage(currentInstruction.image)}
              >
                <div className="aspect-video flex items-center justify-center text-muted-foreground relative">
                  <img
                    src={currentInstruction.image}
                    alt={currentInstruction.title}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      // Fallback если картинка не загрузилась
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
              </div>
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
      </>
    );
  }

  // Part 2: Form
  return (
    <>
      {/* Fullscreen Image Overlay - рендерится через портал в body */}
      {fullscreenImage && (
        <FullscreenImageOverlay
          src={fullscreenImage}
          onClose={() => setFullscreenImage(null)}
        />
      )}

      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto w-[95vw] p-4 sm:p-6"
          onPointerDownOutside={(e) => {
            if (fullscreenImage) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (fullscreenImage) {
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

            {/* Screenshot - where to find IDs */}
            <div
              className="border rounded-lg overflow-hidden bg-muted/30 cursor-pointer group relative"
              onClick={() => setFullscreenImage(INSTRUCTION_IMAGES.formHelper)}
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
            </div>

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
                  Instagram Account ID <span className="text-red-500">*</span>
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
                  ID аккаунта Instagram из раздела "Аккаунты Instagram"
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
    </>
  );
}
