import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, X, CheckSquare, AlertCircle, Loader2 } from 'lucide-react';
import {
  getLeadCustomFields,
  getQualificationField,
  setQualificationField,
  type CustomField,
} from '@/services/amocrmApi';

interface AmoCRMQualificationFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAccountId: string;
  onSave?: () => void;
}

export const AmoCRMQualificationFieldModal: React.FC<AmoCRMQualificationFieldModalProps> = ({
  isOpen,
  onClose,
  userAccountId,
  onSave,
}) => {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [currentFieldName, setCurrentFieldName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load custom fields and current setting on mount
  useEffect(() => {
    if (isOpen && userAccountId) {
      loadData();
    }
  }, [isOpen, userAccountId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load both custom fields and current setting in parallel
      const [fieldsResponse, settingResponse] = await Promise.all([
        getLeadCustomFields(userAccountId),
        getQualificationField(userAccountId),
      ]);

      setFields(fieldsResponse.fields || []);
      setSelectedFieldId(settingResponse.fieldId);
      setCurrentFieldName(settingResponse.fieldName);
    } catch (err: any) {
      console.error('Failed to load qualification field data:', err);
      setError(err.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const selectedField = fields.find(f => f.field_id === selectedFieldId);
      const fieldName = selectedField?.field_name || null;

      await setQualificationField(userAccountId, selectedFieldId, fieldName);

      setCurrentFieldName(fieldName);
      setSuccessMessage(
        selectedFieldId
          ? `Поле "${fieldName}" установлено для определения квалификации`
          : 'Квалификация по кастомному полю отключена'
      );

      if (onSave) {
        onSave();
      }

      // Close modal after success with delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Failed to save qualification field:', err);
      setError(err.message || 'Не удалось сохранить настройку');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const handleClear = async () => {
    setSelectedFieldId(null);
  };

  const selectedFieldName = selectedFieldId
    ? fields.find(f => f.field_id === selectedFieldId)?.field_name
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-green-600" />
            Настройка квалификации лидов
          </DialogTitle>
          <DialogDescription>
            Выберите поле в карточке лида AmoCRM (тип: Флаг), которое определяет
            квалификацию. Если флаг установлен, лид считается квалифицированным.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="ml-2 text-sm text-muted-foreground">
                Загрузка полей из AmoCRM...
              </span>
            </div>
          ) : (
            <>
              {/* Current setting indicator */}
              {currentFieldName && !selectedFieldId && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                  <Check className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-blue-800 font-medium">Текущее поле:</p>
                    <p className="text-blue-700">{currentFieldName}</p>
                  </div>
                </div>
              )}

              {/* Field selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Поле квалификации</label>
                <Select
                  value={selectedFieldId?.toString() || 'none'}
                  onValueChange={(value) =>
                    setSelectedFieldId(value === 'none' ? null : parseInt(value))
                  }
                  disabled={fields.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={fields.length === 0 ? 'Нет полей типа чекбокс' : 'Выберите поле'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Не использовать (отключить)</span>
                    </SelectItem>
                    {fields.map((field) => (
                      <SelectItem key={field.field_id} value={field.field_id.toString()}>
                        <div className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-green-600" />
                          <span>{field.field_name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {fields.length === 0 && !loading && (
                  <p className="text-xs text-amber-600">
                    В AmoCRM не найдено полей типа «Флаг» в карточке лида.
                    Создайте поле типа «Флаг» в настройках AmoCRM.
                  </p>
                )}
              </div>

              {/* Selected field info */}
              {selectedFieldId && selectedFieldName && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-green-800 font-medium">Выбранное поле:</p>
                      <p className="text-green-700">{selectedFieldName}</p>
                      <p className="text-green-600 text-xs mt-1">
                        Лиды с установленным флагом будут считаться квалифицированными
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Info about CPQL */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-600">
                    Если поле квалификации настроено, CPQL (стоимость квалифицированного лида)
                    будет рассчитываться на основе этого поля вместо данных WhatsApp.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
              <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">{successMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip} disabled={saving}>
            Пропустить
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Сохранение...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Сохранить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AmoCRMQualificationFieldModal;
