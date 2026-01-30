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
  getBitrix24LeadCustomFields,
  getBitrix24DealCustomFields,
  getBitrix24ContactCustomFields,
  getBitrix24QualificationFields,
  setBitrix24QualificationFields,
  type CustomField,
  type QualificationFieldConfig,
} from '@/services/bitrix24Api';

interface Bitrix24QualificationFieldModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAccountId: string;
  entityType: 'lead' | 'deal' | 'both';
  onSave?: () => void;
}

interface SelectedField {
  entityType: 'lead' | 'deal' | 'contact';
  fieldId: string | null;
  fieldName: string | null;
  enumId: string | null;
}

const MAX_FIELDS = 3;

export const Bitrix24QualificationFieldModal: React.FC<Bitrix24QualificationFieldModalProps> = ({
  isOpen,
  onClose,
  userAccountId,
  entityType,
  onSave,
}) => {
  const [leadFields, setLeadFields] = useState<CustomField[]>([]);
  const [dealFields, setDealFields] = useState<CustomField[]>([]);
  const [contactFields, setContactFields] = useState<CustomField[]>([]);
  const [selectedFields, setSelectedFields] = useState<SelectedField[]>([
    { entityType: entityType === 'deal' ? 'deal' : 'lead', fieldId: null, fieldName: null, enumId: null }
  ]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load custom fields and current settings on mount
  useEffect(() => {
    if (isOpen && userAccountId) {
      loadData();
    }
  }, [isOpen, userAccountId, entityType]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load custom fields based on entity type
      const loadPromises: Promise<any>[] = [];

      if (entityType === 'lead' || entityType === 'both') {
        loadPromises.push(
          getBitrix24LeadCustomFields(userAccountId)
            .then(res => setLeadFields(res.fields || []))
            .catch(() => setLeadFields([]))
        );
      }

      if (entityType === 'deal' || entityType === 'both') {
        loadPromises.push(
          getBitrix24DealCustomFields(userAccountId)
            .then(res => setDealFields(res.fields || []))
            .catch(() => setDealFields([]))
        );
      }

      // Always load contact fields (contacts can be linked to both leads and deals)
      loadPromises.push(
        getBitrix24ContactCustomFields(userAccountId)
          .then(res => setContactFields(res.fields || []))
          .catch(() => setContactFields([]))
      );

      await Promise.all(loadPromises);

      // Try to load saved settings
      try {
        const settingsResponse = await getBitrix24QualificationFields(userAccountId);
        if (settingsResponse.fields && settingsResponse.fields.length > 0) {
          setSelectedFields(
            settingsResponse.fields.map(f => ({
              entityType: f.entity_type,
              fieldId: f.field_id,
              fieldName: f.field_name,
              enumId: f.enum_id || null,
            }))
          );
        } else {
          setSelectedFields([
            { entityType: entityType === 'deal' ? 'deal' : 'lead', fieldId: null, fieldName: null, enumId: null }
          ]);
        }
      } catch (settingsErr: any) {
        console.warn('Could not load saved settings:', settingsErr.message);
        setSelectedFields([
          { entityType: entityType === 'deal' ? 'deal' : 'lead', fieldId: null, fieldName: null, enumId: null }
        ]);
      }
    } catch (err: any) {
      console.error('Failed to load qualification field data:', err);
      setError(err.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const getFieldsForEntityType = (et: 'lead' | 'deal' | 'contact'): CustomField[] => {
    switch (et) {
      case 'lead': return leadFields;
      case 'deal': return dealFields;
      case 'contact': return contactFields;
      default: return [];
    }
  };

  const handleEntityTypeChange = (index: number, value: string) => {
    const newEntityType = value as 'lead' | 'deal' | 'contact';
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { entityType: newEntityType, fieldId: null, fieldName: null, enumId: null };
      return updated;
    });
  };

  const handleFieldChange = (index: number, value: string) => {
    const fieldId = value === 'none' ? null : value;
    setSelectedFields(prev => {
      const updated = [...prev];
      const fields = getFieldsForEntityType(updated[index].entityType);
      const field = fields.find(f => f.id === fieldId);
      updated[index] = {
        ...updated[index],
        fieldId,
        fieldName: field?.fieldName || null,
        enumId: null
      };
      return updated;
    });
  };

  const handleEnumChange = (index: number, value: string) => {
    const enumId = value === 'none' ? null : value;
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enumId };
      return updated;
    });
  };

  const addField = () => {
    if (selectedFields.length < MAX_FIELDS) {
      setSelectedFields(prev => [...prev, {
        entityType: entityType === 'deal' ? 'deal' : 'lead',
        fieldId: null,
        fieldName: null,
        enumId: null
      }]);
    }
  };

  const removeField = (index: number) => {
    if (selectedFields.length > 1) {
      setSelectedFields(prev => prev.filter((_, i) => i !== index));
    } else {
      setSelectedFields([{
        entityType: entityType === 'deal' ? 'deal' : 'lead',
        fieldId: null,
        fieldName: null,
        enumId: null
      }]);
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
          const fields = getFieldsForEntityType(sf.entityType);
          const field = fields.find(f => f.id === sf.fieldId)!;
          let enumValue: string | null = null;
          if (field.list && sf.enumId) {
            const selectedEnum = field.list.find(e => e.id === sf.enumId);
            enumValue = selectedEnum?.value || null;
          }
          return {
            field_id: sf.fieldId!,
            field_name: field.fieldName,
            field_type: field.userTypeId,
            entity_type: sf.entityType,
            enum_id: sf.enumId || undefined,
            enum_value: enumValue || undefined,
          };
        });

      await setBitrix24QualificationFields(userAccountId, fieldsToSave);

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

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Failed to save qualification fields:', err);
      setError(err.message || 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const getFieldById = (et: 'lead' | 'deal' | 'contact', fieldId: string | null): CustomField | null => {
    if (!fieldId) return null;
    const fields = getFieldsForEntityType(et);
    return fields.find(f => f.id === fieldId) || null;
  };

  const isEnumType = (field: CustomField | null) => {
    return field?.userTypeId === 'enumeration' && field?.list && field.list.length > 0;
  };

  const isBooleanType = (field: CustomField | null) => {
    return field?.userTypeId === 'boolean';
  };

  // Check if a field row is valid
  const isFieldRowValid = (sf: SelectedField) => {
    if (!sf.fieldId) return true;
    const field = getFieldById(sf.entityType, sf.fieldId);
    if (!field) return false;
    if (isBooleanType(field)) return true;
    if (isEnumType(field)) return sf.enumId !== null;
    return true;
  };

  const canSave = selectedFields.every(isFieldRowValid);

  const getFieldIcon = (field: CustomField | null) => {
    if (!field) return null;
    if (isBooleanType(field)) {
      return <CheckSquare className="h-4 w-4 text-green-600" />;
    }
    return <List className="h-4 w-4 text-blue-600" />;
  };

  const getFieldTypeLabel = (userTypeId: string) => {
    switch (userTypeId) {
      case 'boolean': return 'Да/Нет';
      case 'enumeration': return 'Список';
      case 'string': return 'Строка';
      default: return userTypeId;
    }
  };

  const getEntityTypeLabel = (et: 'lead' | 'deal' | 'contact') => {
    switch (et) {
      case 'lead': return 'Лид';
      case 'deal': return 'Сделка';
      case 'contact': return 'Контакт';
    }
  };

  const getAvailableEntityTypes = (): ('lead' | 'deal' | 'contact')[] => {
    const types: ('lead' | 'deal' | 'contact')[] = [];
    if (entityType === 'lead' || entityType === 'both') types.push('lead');
    if (entityType === 'deal' || entityType === 'both') types.push('deal');
    types.push('contact');
    return types;
  };

  const activeFieldsCount = selectedFields.filter(sf => sf.fieldId !== null).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-green-600" />
            Настройка квалификации (Bitrix24)
          </DialogTitle>
          <DialogDescription>
            Выберите до {MAX_FIELDS} полей в Bitrix24 для определения квалификации.
            Лид/сделка считается квалифицированным, если хотя бы одно из полей установлено.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="ml-2 text-sm text-muted-foreground">
                Загрузка полей из Bitrix24...
              </span>
            </div>
          ) : (
            <>
              {/* Field selectors */}
              {selectedFields.map((sf, index) => {
                const currentField = getFieldById(sf.entityType, sf.fieldId);
                const availableFields = getFieldsForEntityType(sf.entityType);
                const availableEntityTypes = getAvailableEntityTypes();

                return (
                  <div key={index} className="space-y-2 p-3 border rounded-lg bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">
                        Условие {index + 1}
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

                    {/* Entity type selector */}
                    {availableEntityTypes.length > 1 && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Тип сущности</label>
                        <Select
                          value={sf.entityType}
                          onValueChange={(value) => handleEntityTypeChange(index, value)}
                        >
                          <SelectTrigger className="w-full bg-white dark:bg-gray-900 dark:border-gray-600">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableEntityTypes.map((et) => (
                              <SelectItem key={et} value={et}>
                                {getEntityTypeLabel(et)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Field selector */}
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Поле</label>
                      <Select
                        value={sf.fieldId || 'none'}
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
                          {availableFields.map((field) => (
                            <SelectItem key={field.id} value={field.id}>
                              <div className="flex items-center gap-2">
                                {getFieldIcon(field)}
                                <span>{field.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({getFieldTypeLabel(field.userTypeId)})
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Enum selector for enumeration fields */}
                    {isEnumType(currentField) && (
                      <div className="mt-2">
                        <label className="text-xs text-muted-foreground">Значение квалификации</label>
                        <Select
                          value={sf.enumId || 'none'}
                          onValueChange={(value) => handleEnumChange(index, value)}
                        >
                          <SelectTrigger className="w-full bg-white dark:bg-gray-900 dark:border-gray-600 mt-1">
                            <SelectValue placeholder="Выберите значение" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <span className="text-muted-foreground">Не выбрано</span>
                            </SelectItem>
                            {currentField?.list?.map((enumItem) => (
                              <SelectItem key={enumItem.id} value={enumItem.id}>
                                {enumItem.value}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Field validation messages */}
                    {currentField && isBooleanType(currentField) && (
                      <p className="text-xs text-green-600">
                        Квалифицирован, если поле = Да
                      </p>
                    )}
                    {currentField && isEnumType(currentField) && sf.enumId && currentField.list && (
                      <p className="text-xs text-green-600">
                        Значение: {currentField.list.find(e => e.id === sf.enumId)?.value}
                      </p>
                    )}
                    {currentField && isEnumType(currentField) && !sf.enumId && (
                      <p className="text-xs text-amber-600">
                        Выберите значение для квалификации
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Add field button */}
              {selectedFields.length < MAX_FIELDS && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addField}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить условие ({selectedFields.length}/{MAX_FIELDS})
                </Button>
              )}

              {/* Summary */}
              {activeFieldsCount > 0 && (
                <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-green-800 dark:text-green-300 font-medium">
                        {activeFieldsCount === 1 ? 'Выбрано 1 условие' : `Выбрано ${activeFieldsCount} условия`}
                      </p>
                      <p className="text-green-600 dark:text-green-400 text-xs mt-1">
                        Квалифицирован, если хотя бы одно условие выполнено
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
                    выбранных полей из Bitrix24.
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

export default Bitrix24QualificationFieldModal;
