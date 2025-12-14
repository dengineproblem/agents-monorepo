import { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableData } from '@/types/assistantUI';

interface UITableProps {
  data: TableData;
}

type SortDirection = 'asc' | 'desc' | null;

export function UITable({ data }: UITableProps) {
  const { headers, rows, sortable = false, compact = false } = data;
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const handleSort = (columnIndex: number) => {
    if (!sortable) return;

    if (sortColumn === columnIndex) {
      // Cycle: asc -> desc -> null
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortColumn(columnIndex);
      setSortDirection('asc');
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    if (sortColumn === null || sortDirection === null) return 0;

    const aVal = a[sortColumn];
    const bVal = b[sortColumn];

    // Handle numeric values
    const aNum = typeof aVal === 'number' ? aVal : parseFloat(String(aVal).replace(/[^\d.-]/g, ''));
    const bNum = typeof bVal === 'number' ? bVal : parseFloat(String(bVal).replace(/[^\d.-]/g, ''));

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    }

    // String comparison
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();

    if (sortDirection === 'asc') {
      return aStr.localeCompare(bStr);
    }
    return bStr.localeCompare(aStr);
  });

  const SortIcon = ({ columnIndex }: { columnIndex: number }) => {
    if (sortColumn !== columnIndex) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="h-3 w-3" />;
    }
    return <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {headers.map((header, idx) => (
                <th
                  key={idx}
                  className={cn(
                    'text-left font-medium text-muted-foreground',
                    compact ? 'px-2 py-1.5' : 'px-3 py-2',
                    sortable && 'cursor-pointer hover:bg-muted/70 select-none'
                  )}
                  onClick={() => handleSort(idx)}
                >
                  <div className="flex items-center gap-1">
                    {header}
                    {sortable && <SortIcon columnIndex={idx} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="hover:bg-muted/30 transition-colors"
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className={cn(
                      compact ? 'px-2 py-1.5' : 'px-3 py-2',
                      // Right-align numbers
                      typeof cell === 'number' && 'text-right font-mono'
                    )}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="p-4 text-center text-muted-foreground text-sm">
          Нет данных
        </div>
      )}
    </div>
  );
}

function formatCell(value: string | number): string {
  if (typeof value === 'number') {
    // Format large numbers with spaces
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString('ru-RU');
    }
    return String(value);
  }
  return value;
}

export default UITable;
