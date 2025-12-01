import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Copy, Check, FileText, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { textCreativesApi, TEXT_TYPES, TextCreativeType } from '@/services/textCreativesApi';

interface TextTabProps {
  userId: string | null;
  initialPrompt?: string;
}

export const VideoScriptsTab: React.FC<TextTabProps> = ({ userId, initialPrompt }) => {
  // State
  const [textType, setTextType] = useState<TextCreativeType>('storytelling');
  const [userPrompt, setUserPrompt] = useState(initialPrompt || '');

  // Устанавливаем initialPrompt при изменении
  useEffect(() => {
    if (initialPrompt) {
      setUserPrompt(initialPrompt);
    }
  }, [initialPrompt]);
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editInstructions, setEditInstructions] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Генерация текста
  const handleGenerate = async () => {
    if (!userId) {
      toast.error('Необходимо авторизоваться');
      return;
    }

    if (!userPrompt.trim()) {
      toast.error('Опишите, о чём должен быть текст');
      return;
    }

    setIsGenerating(true);
    setGeneratedText('');
    setIsEditMode(false);

    try {
      const response = await textCreativesApi.generate({
        user_id: userId,
        text_type: textType,
        user_prompt: userPrompt.trim()
      });

      if (response.success && response.text) {
        setGeneratedText(response.text);
        toast.success('Текст сгенерирован!');
      } else {
        toast.error(response.error || 'Не удалось сгенерировать текст');
      }
    } catch (error: any) {
      console.error('[TextTab] Error generating:', error);
      toast.error('Ошибка при генерации текста');
    } finally {
      setIsGenerating(false);
    }
  };

  // Редактирование текста
  const handleEdit = async () => {
    if (!userId) {
      toast.error('Необходимо авторизоваться');
      return;
    }

    if (!editInstructions.trim()) {
      toast.error('Опишите, что нужно изменить');
      return;
    }

    setIsEditing(true);

    try {
      const response = await textCreativesApi.edit({
        user_id: userId,
        text_type: textType,
        original_text: generatedText,
        edit_instructions: editInstructions.trim()
      });

      if (response.success && response.text) {
        setGeneratedText(response.text);
        setIsEditMode(false);
        setEditInstructions('');
        toast.success('Текст отредактирован!');
      } else {
        toast.error(response.error || 'Не удалось отредактировать текст');
      }
    } catch (error: any) {
      console.error('[TextTab] Error editing:', error);
      toast.error('Ошибка при редактировании текста');
    } finally {
      setIsEditing(false);
    }
  };

  // Копирование текста
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedText);
      setIsCopied(true);
      toast.success('Текст скопирован!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error('Не удалось скопировать');
    }
  };

  // Placeholder текст в зависимости от типа
  const getPlaceholder = () => {
    switch (textType) {
      case 'storytelling':
        return 'Например: История о том, как клиент решил проблему с помощью нашего продукта. Фокус на эмоциях и трансформации...';
      case 'direct_offer':
        return 'Например: Акция на установку имплантов. Цена 69000 тенге. Безболезненно, за 1 час...';
      case 'expert_video':
        return 'Например: Почему возникает кариес даже при регулярной чистке зубов. Раскрыть тему профессиональной чистки...';
      case 'telegram_post':
        return 'Например: Пост о важности регулярных осмотров у стоматолога. Информационный, не рекламный...';
      case 'threads_post':
        return 'Например: Провокационный пост о мифах в стоматологии. Короткий, вовлекающий в дискуссию...';
      default:
        return 'Опишите, о чём должен быть текст...';
    }
  };

  return (
    <div className="space-y-6 py-6">
      {/* Форма генерации */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Генерация текста
          </CardTitle>
          <CardDescription>
            Создайте текст для видео, поста или рекламы на основе контекста вашего бизнеса
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Выбор типа текста */}
          <div className="space-y-2">
            <Label>Тип текста</Label>
            <Select value={textType} onValueChange={(v) => setTextType(v as TextCreativeType)}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите тип текста" />
              </SelectTrigger>
              <SelectContent>
                {TEXT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Описание типа */}
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            {textType === 'storytelling' && (
              <p><strong>Storytelling</strong> — эмоциональная история с личным опытом, хуком и крюком для удержания внимания.</p>
            )}
            {textType === 'direct_offer' && (
              <p><strong>Прямой оффер</strong> — короткое продающее сообщение: результат + время + безопасность + CTA.</p>
            )}
            {textType === 'expert_video' && (
              <p><strong>Видео экспертное</strong> — вирусный хук с экспертным раскрытием темы и решением.</p>
            )}
            {textType === 'telegram_post' && (
              <p><strong>Пост в Telegram</strong> — информационно-познавательный контент без явной рекламы.</p>
            )}
            {textType === 'threads_post' && (
              <p><strong>Пост в Threads</strong> — короткий провокационный пост для вовлечения в дискуссию.</p>
            )}
          </div>

          {/* Поле для задачи */}
          <div className="space-y-2">
            <Label>Ваша задача</Label>
            <Textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder={getPlaceholder()}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Опишите тему, акцент, ключевые моменты. Агент использует контекст вашего бизнеса и лучшие креативы.
            </p>
          </div>

          {/* Кнопка генерации */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !userPrompt.trim() || !userId}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Генерация...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Сгенерировать
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Результат */}
      {generatedText && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Результат</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditMode(!isEditMode);
                    setEditInstructions('');
                  }}
                  className="flex items-center gap-2"
                >
                  {isEditMode ? (
                    <>
                      <X className="h-4 w-4" />
                      Отмена
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      Редактировать
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="flex items-center gap-2"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Скопировано
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Копировать
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Форма редактирования */}
            {isEditMode && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <Label>Что нужно изменить?</Label>
                <Textarea
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  placeholder="Например: Сделай хук более провокационным, добавь конкретную цену..."
                  rows={2}
                  className="resize-none"
                />
                <Button
                  onClick={handleEdit}
                  disabled={isEditing || !editInstructions.trim()}
                  className="w-full"
                  size="sm"
                >
                  {isEditing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Редактирование...
                    </>
                  ) : (
                    <>
                      <Pencil className="mr-2 h-4 w-4" />
                      Применить изменения
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Текст результата */}
            <div className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm leading-relaxed">
              {generatedText}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
