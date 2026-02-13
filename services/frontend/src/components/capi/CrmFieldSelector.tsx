import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2 } from 'lucide-react';
import type { CustomField as AmocrmCustomField } from '@/services/amocrmApi';
import type { CustomField as Bitrix24CustomField } from '@/services/bitrix24Api';

export type CrmType = 'amocrm' | 'bitrix24';

export interface SelectedCapiField {
  fieldId: string | number | null;
  enumId: string | number | null;
}

const MAX_CAPI_FIELDS = 5;

interface CrmFieldSelectorProps {
  fields: (AmocrmCustomField | Bitrix24CustomField)[];
  selectedFields: SelectedCapiField[];
  setSelectedFields: React.Dispatch<React.SetStateAction<SelectedCapiField[]>>;
  crmType: CrmType;
  isSubmitting: boolean;
  getFieldById: (fieldId: string | number | null) => AmocrmCustomField | Bitrix24CustomField | undefined;
  getFieldId: (field: AmocrmCustomField | Bitrix24CustomField) => string | number;
  getFieldName: (field: AmocrmCustomField | Bitrix24CustomField) => string;
  getFieldType: (field: AmocrmCustomField | Bitrix24CustomField) => string;
  getFieldEnums: (field: AmocrmCustomField | Bitrix24CustomField) => Array<{ id: string | number; value: string }>;
  needsEnumSelection: (field: AmocrmCustomField | Bitrix24CustomField | null) => boolean;
}

const CrmFieldSelector: React.FC<CrmFieldSelectorProps> = ({
  fields,
  selectedFields,
  setSelectedFields,
  crmType,
  isSubmitting,
  getFieldById,
  getFieldId,
  getFieldName,
  getFieldType,
  getFieldEnums,
  needsEnumSelection,
}) => {
  const handleFieldChange = (index: number, value: string) => {
    const fieldId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value) : value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { fieldId, enumId: null };
      return updated;
    });
  };

  const handleEnumChange = (index: number, value: string) => {
    const enumId = value === 'none' ? null : (crmType === 'amocrm' ? parseInt(value) : value);
    setSelectedFields(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], enumId };
      return updated;
    });
  };

  const addField = () => {
    if (selectedFields.length < MAX_CAPI_FIELDS) {
      setSelectedFields(prev => [...prev, { fieldId: null, enumId: null }]);
    }
  };

  const removeField = (index: number) => {
    if (selectedFields.length > 1) {
      setSelectedFields(prev => prev.filter((_, i) => i !== index));
    } else {
      setSelectedFields([{ fieldId: null, enumId: null }]);
    }
  };

  const isCheckboxType = (field: AmocrmCustomField | Bitrix24CustomField | null): boolean => {
    if (!field) return false;
    const fieldType = getFieldType(field);
    return fieldType === 'checkbox' || fieldType === 'boolean';
  };

  const getSelectedCheckboxFieldIds = (excludeIndex: number) => {
    return selectedFields
      .filter((_, i) => i !== excludeIndex)
      .filter(sf => {
        if (!sf.fieldId) return false;
        const field = getFieldById(sf.fieldId);
        return field && isCheckboxType(field);
      })
      .map(sf => sf.fieldId)
      .filter(Boolean);
  };

  const activeFieldsCount = selectedFields.filter(sf => sf.fieldId !== null).length;

  return (
    <div className="space-y-2">
      {selectedFields.map((sf, index) => {
        const selectedCheckboxIds = getSelectedCheckboxFieldIds(index);
        const currentField = sf.fieldId ? getFieldById(sf.fieldId) : null;

        return (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Select
                value={sf.fieldId?.toString() || 'none'}
                onValueChange={(value) => handleFieldChange(index, value)}
                disabled={isSubmitting || fields.length === 0}
              >
                <SelectTrigger className="w-full bg-white dark:bg-gray-900 h-8 text-sm">
                  <SelectValue placeholder="Выберите поле" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Не выбрано</span>
                  </SelectItem>
                  {fields.map((field) => {
                    const fId = getFieldId(field);
                    const isDisabled = isCheckboxType(field) && selectedCheckboxIds.includes(fId);
                    return (
                      <SelectItem
                        key={fId}
                        value={fId.toString()}
                        disabled={isDisabled}
                      >
                        {getFieldName(field)} ({getFieldType(field)})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {currentField && needsEnumSelection(currentField) && (
                <Select
                  value={sf.enumId?.toString() || 'none'}
                  onValueChange={(value) => handleEnumChange(index, value)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full bg-white dark:bg-gray-900 h-8 text-sm">
                    <SelectValue placeholder="Выберите значение" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Не выбрано</span>
                    </SelectItem>
                    {getFieldEnums(currentField).map((enumItem) => (
                      <SelectItem key={enumItem.id} value={enumItem.id.toString()}>
                        {enumItem.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedFields.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeField(index)}
                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 flex-shrink-0"
                disabled={isSubmitting}
              >
                <span className="text-lg">&times;</span>
              </Button>
            )}
          </div>
        );
      })}

      {selectedFields.length < MAX_CAPI_FIELDS && fields.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={addField}
          disabled={isSubmitting}
          className="w-full h-8 text-xs"
        >
          + Добавить поле ({selectedFields.length}/{MAX_CAPI_FIELDS})
        </Button>
      )}

      {activeFieldsCount > 0 && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {activeFieldsCount === 1 ? 'Выбрано 1 поле' : `Выбрано ${activeFieldsCount} поля`}
        </p>
      )}
    </div>
  );
};

export default CrmFieldSelector;
