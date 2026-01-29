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
import { Check, X, CheckSquare, AlertCircle, Loader2, List, Plus, Trash2 } from 'lucide-react';
import {
  getLeadCustomFields,
  getQualificationFields,
  setQualificationFields,
  type CustomField,
  type QualificationFieldConfig,
} from '@/services/amocrmApi';

interface AmoCRMQualificationFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAccountId: string;
  onSave?: () => void;
}

interface SelectedField {
  fieldId: number | null;
  enumId: number | null;
}

const MAX_FIELDS = 3;

export const AmoCRMQualificationFieldModal: React.FC<AmoCRMQualificationFieldModalProps> = ({
  isOpen,
  onClose,
  userAccountId,
  onSave,
}) => {
  const [availableFields, setAvailableFields] = useState<CustomField[]>([]);
  const [selectedFields, setSelectedFields] = useState<SelectedField[]>([{ fieldId: null, enumId: null }]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load custom fields and current settings on mount
  useEffect(() => {
    if (isOpen && userAccountId) {
      loadData();
    }
  }, [isOpen, userAccountId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load custom fields first (required)
      const fieldsResponse = await getLeadCustomFields(userAccountId);
      setAvailableFields(fieldsResponse.fields || []);

      // Try to load saved settings (may fail if migration not applied)
      try {
        const settingsResponse = await getQualificationFields(userAccountId);
        if (settingsResponse.fields && settingsResponse.fields.length > 0) {
          setSelectedFields(
            settingsResponse.fields.map(f => ({
              fieldId: f.field_id,
              enumId: f.enum_id || null,
            }))
          );
        } else {
          setSelectedFields([{ fieldId: null, enumId: null }]);
        }
      } catch (settingsErr: any) {
        setSelectedFields([{ fieldId: null, enumId: null }]);
      }
    } catch (err: any) {

      setError(err.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (index: number, value: string) => {
    const fieldId = value === 'none' ? null : parseInt(value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { fieldId, enumId: null }; // Reset enum when field changes
      return updated;
    });
  };

  const handleEnumChange = (index: number, value: string) => {
    const enumId = value === 'none' ? null : parseInt(value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enumId };
      return updated;
    });
  };

  const addField = () => {
    if (selectedFields.length < MAX_FIELDS) {
      setSelectedFields(prev => [...prev, { fieldId: null, enumId: null }]);
    }
  };

  const removeField = (index: number) => {
    if (selectedFields.length > 1) {
      setSelectedFields(prev => prev.filter((_, i) => i !== index));
    } else {
      // If only one field, just clear it
      setSelectedFields([{ fieldId: null, enumId: null }]);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Convert selected fields to config format
      const fieldsToSave: QualificationFieldConfig[] = selectedFields
        .filter(sf => sf.fieldId !== null)
        .map(sf => {
          const field = availableFields.find(f => f.field_id === sf.fieldId)!;
          let enumValue: string | null = null;
          if (field.enums && sf.enumId) {
            const selectedEnum = field.enums.find(e => e.id === sf.enumId);
            enumValue = selectedEnum?.value || null;
          }
          return {
            field_id: sf.fieldId!,
            field_name: field.field_name,
            field_type: field.field_type,
            enum_id: sf.enumId,
            enum_value: enumValue,
          };
        });

      await setQualificationFields(userAccountId, fieldsToSave);

      if (fieldsToSave.length > 0) {
        const fieldNames = fieldsToSave.map(f => f.field_name).join(', ');
        setSuccessMessage(
          fieldsToSave.length === 1
            ? `Поле "${fieldNames}" установлено для квалификации`
            : `Поля (${fieldsToSave.length}) установлены для квалификации: ${fieldNames}`
        );
      } else {
        setSuccessMessage('Квалификация по кастомным полям отключена');
      }

      if (onSave) {
        onSave();
      }

      // Close modal after success with delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {

      setError(err.message || 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const getFieldById = (fieldId: number | null) => {
    if (!fieldId) return null;
    return availableFields.find(f => f.field_id === fieldId);
  };

  const isSelectType = (field: CustomField | null) => {
    return field?.field_type === 'select' || field?.field_type === 'multiselect';
  };

  const needsEnumSelection = (field: CustomField | null) => {
    return isSelectType(field) && field?.enums && field.enums.length > 0;
  };

  // Check if a field row is valid
  const isFieldRowValid = (sf: SelectedField) => {
    if (!sf.fieldId) return true; // Empty is valid (will be filtered out)
    const field = getFieldById(sf.fieldId);
    if (!field) return false;
    if (field.field_type === 'checkbox') return true;
    if (isSelectType(field)) return sf.enumId !== null;
    return true;
  };

  // Check if all fields are valid
  const canSave = selectedFields.every(isFieldRowValid);

  // Get already selected checkbox field IDs (to disable in other selects)
  // Select/multiselect fields can be selected multiple times with different enum values
  const getSelectedCheckboxFieldIds = (excludeIndex: number) => {
    return selectedFields
      .filter((_, i) => i !== excludeIndex)
      .filter(sf => {
        if (!sf.fieldId) return false;
        const field = getFieldById(sf.fieldId);
        return field?.field_type === 'checkbox'; // Only block checkboxes
      })
      .map(sf => sf.fieldId)
      .filter(Boolean) as number[];
  };

  const getFieldIcon = (fieldType: string) => {
    if (fieldType === 'checkbox') {
      return <CheckSquare className="h-4 w-4 text-green-600" />;
    }
    return <List className="h-4 w-4 text-blue-600" />;
  };

  const getFieldTypeLabel = (fieldType: string) => {
    switch (fieldType) {
      case 'checkbox': return 'Флаг';
      case 'select': return 'Список';
      case 'multiselect': return 'Мультисписок';
      default: return fieldType;
    }
  };

  const activeFieldsCount = selectedFields.filter(sf => sf.fieldId !== null).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-green-600" />
            Настройка квалификации лидов
          </DialogTitle>
          <DialogDescription>
            Выберите до {MAX_FIELDS} полей в карточке AmoCRM для определения квалификации.
            Лид считается квалифицированным, если хотя бы одно из полей установлено.
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
              {/* Field selectors */}
              {selectedFields.map((sf, index) => {
                const selectedCheckboxIds = getSelectedCheckboxFieldIds(index);
                const currentField = getFieldById(sf.fieldId);

                return (
                  <div key={index} className="space-y-2 p-3 border rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">
                        Поле {index + 1}
                      </label>
                      {selectedFields.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeField(index)}
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <Select
                      value={sf.fieldId?.toString() || 'none'}
                      onValueChange={(value) => handleFieldChange(index, value)}
                      disabled={availableFields.length === 0}
                    >
                      <SelectTrigger className="w-full bg-white dark:bg-gray-900 dark:border-gray-600">
                        <SelectValue placeholder="Выберите поле" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-muted-foreground">Не выбрано</span>
                        </SelectItem>
                        {availableFields.map((field) => {
                          // Only disable checkbox fields that are already selected (they have no enum values)
                          const isDisabled = field.field_type === 'checkbox' && selectedCheckboxIds.includes(field.field_id);
                          return (
                            <SelectItem
                              key={field.field_id}
                              value={field.field_id.toString()}
                              disabled={isDisabled}
                            >
                              <div className="flex items-center gap-2">
                                {getFieldIcon(field.field_type)}
                                <span className={isDisabled ? 'text-muted-foreground' : ''}>
                                  {field.field_name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  ({getFieldTypeLabel(field.field_type)})
                                </span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>

                    {/* Enum selector for select/multiselect fields */}
                    {needsEnumSelection(currentField) && (
                      <div className="mt-2">
                        <label className="text-xs text-muted-foreground">Значение квалификации</label>
                        <Select
                          value={sf.enumId?.toString() || 'none'}
                          onValueChange={(value) => handleEnumChange(index, value)}
                        >
                          <SelectTrigger className="w-full bg-white dark:bg-gray-900 dark:border-gray-600 mt-1">
                            <SelectValue placeholder="Выберите значение" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <span className="text-muted-foreground">Не выбрано</span>
                            </SelectItem>
                            {currentField?.enums?.map((enumItem) => (
                              <SelectItem key={enumItem.id} value={enumItem.id.toString()}>
                                {enumItem.value}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Show selected enum value */}
                    {currentField && currentField.field_type === 'checkbox' && (
                      <p className="text-xs text-green-600">
                        ✓ Лид квалифицирован, если флаг установлен
                      </p>
                    )}
                    {currentField && isSelectType(currentField) && sf.enumId && currentField.enums && (
                      <p className="text-xs text-green-600">
                        ✓ Значение: {currentField.enums.find(e => e.id === sf.enumId)?.value}
                      </p>
                    )}
                    {currentField && isSelectType(currentField) && !sf.enumId && (
                      <p className="text-xs text-amber-600">
                        ⚠ Выберите значение для квалификации
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Add field button */}
              {selectedFields.length < MAX_FIELDS && availableFields.length > selectedFields.length && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addField}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить поле ({selectedFields.length}/{MAX_FIELDS})
                </Button>
              )}

              {availableFields.length === 0 && !loading && (
                <div className="text-center py-4">
                  <p className="text-sm text-amber-600">
                    В AmoCRM не найдено подходящих полей (Флаг, Список, Мультисписок).
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Создайте нужное поле в настройках AmoCRM.
                  </p>
                </div>
              )}

              {/* Summary */}
              {activeFieldsCount > 0 && (
                <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-green-800 dark:text-green-300 font-medium">
                        {activeFieldsCount === 1 ? 'Выбрано 1 поле' : `Выбрано ${activeFieldsCount} поля`}
                      </p>
                      <p className="text-green-600 dark:text-green-400 text-xs mt-1">
                        Лид квалифицирован, если хотя бы одно условие выполнено
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Info about CPQL */}
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    CPQL (стоимость квалифицированного лида) будет рассчитываться на основе
                    выбранных полей вместо данных WhatsApp.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <X className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip} disabled={saving}>
            Пропустить
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || !canSave}>
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
