/**
 * Утилиты для экспорта данных в CSV
 */

interface ExportColumn<T> {
  header: string;
  accessor: (item: T) => string | number | null | undefined;
}

/**
 * Экспортировать данные в CSV файл
 */
export function exportToCSV<T>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
): void {
  // BOM для корректного отображения кириллицы в Excel
  const BOM = '\uFEFF';

  // Заголовки
  const headers = columns.map(col => escapeCSV(col.header)).join(';');

  // Строки данных
  const rows = data.map(item =>
    columns.map(col => {
      const value = col.accessor(item);
      return escapeCSV(value?.toString() ?? '');
    }).join(';')
  );

  // Собираем CSV
  const csv = BOM + [headers, ...rows].join('\n');

  // Создаём и скачиваем файл
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${formatDateForFilename(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Экранирование значений для CSV
 */
function escapeCSV(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Форматирование даты для имени файла
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Форматирование даты для ячейки
 */
export function formatDateForExport(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ru-RU');
}

/**
 * Форматирование даты и времени для отображения
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  // toLocaleString автоматически конвертирует UTC в локальное время браузера
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Форматирование суммы для ячейки
 */
export function formatAmountForExport(amount: number | null | undefined): string {
  if (amount == null) return '';
  return amount.toLocaleString('ru-RU');
}
