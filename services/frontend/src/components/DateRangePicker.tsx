import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { useAppContext } from '@/context/AppContext';
import { format, subDays, startOfDay } from 'date-fns';
import { Toggle } from '@/components/ui/toggle';
import { CalendarDays } from 'lucide-react';

interface DateRangePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ open, onOpenChange }) => {
  const { dateRange, setDateRange } = useAppContext();
  const [selectedOption, setSelectedOption] = React.useState<string>('today');
  const [showCustomCalendar, setShowCustomCalendar] = React.useState(false);
  const [customRange, setCustomRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined
  });
  
  const handleSelectOption = (option: string) => {
    if (option === 'custom') {
      setSelectedOption(option);
      setShowCustomCalendar(true);
      return;
    }

    setSelectedOption(option);
    setShowCustomCalendar(false);
    
    const today = startOfDay(new Date());
    let newRange;
    
    switch (option) {
      case 'today':
        newRange = {
          since: format(today, 'yyyy-MM-dd'),
          until: format(today, 'yyyy-MM-dd')
        };
        break;
      case 'yesterday':
        const yesterday = subDays(today, 1);
        newRange = {
          since: format(yesterday, 'yyyy-MM-dd'),
          until: format(yesterday, 'yyyy-MM-dd')
        };
        break;
      case 'last7days':
        newRange = {
          since: format(subDays(today, 7), 'yyyy-MM-dd'),
          until: format(today, 'yyyy-MM-dd')
        };
        break;
      case 'last30days':
        newRange = {
          since: format(subDays(today, 30), 'yyyy-MM-dd'),
          until: format(today, 'yyyy-MM-dd')
        };
        break;
      default:
        newRange = { ...dateRange };
    }
    
    console.log('Selected option:', option, 'New range:', newRange);
    setDateRange(newRange);
    onOpenChange(false);
  };

  const handleCustomRangeApply = () => {
    if (customRange.from && customRange.to) {
      const newRange = {
        since: format(customRange.from, 'yyyy-MM-dd'),
        until: format(customRange.to, 'yyyy-MM-dd')
      };
      console.log('Applied custom range:', newRange);
      setDateRange(newRange);
      onOpenChange(false);
    }
  };

  const handleCustomRangeCancel = () => {
    setShowCustomCalendar(false);
    setCustomRange({ from: undefined, to: undefined });
    // Восстанавливаем предыдущую опцию
    const today = startOfDay(new Date());
    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    const last7DaysStr = format(subDays(today, 7), 'yyyy-MM-dd');
    const last30DaysStr = format(subDays(today, 30), 'yyyy-MM-dd');
    
    if (dateRange.since === todayStr && dateRange.until === todayStr) {
      setSelectedOption('today');
    } else if (dateRange.since === yesterdayStr && dateRange.until === yesterdayStr) {
      setSelectedOption('yesterday');
    } else if (dateRange.since === last7DaysStr && dateRange.until === todayStr) {
      setSelectedOption('last7days');
    } else if (dateRange.since === last30DaysStr && dateRange.until === todayStr) {
      setSelectedOption('last30days');
    } else {
      setSelectedOption('custom');
    }
  };

  React.useEffect(() => {
    // Set the selected option based on the current date range
    const today = startOfDay(new Date());
    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    const last7DaysStr = format(subDays(today, 7), 'yyyy-MM-dd');
    const last30DaysStr = format(subDays(today, 30), 'yyyy-MM-dd');
    
    if (dateRange.since === todayStr && dateRange.until === todayStr) {
      setSelectedOption('today');
    } else if (dateRange.since === yesterdayStr && dateRange.until === yesterdayStr) {
      setSelectedOption('yesterday');
    } else if (dateRange.since === last7DaysStr && dateRange.until === todayStr) {
      setSelectedOption('last7days');
    } else if (dateRange.since === last30DaysStr && dateRange.until === todayStr) {
      setSelectedOption('last30days');
    } else {
      setSelectedOption('custom');
    }
  }, [dateRange, open]);

  React.useEffect(() => {
    // Если открывается диалог и выбран кастомный период, инициализируем календарь
    if (open && selectedOption === 'custom') {
      setShowCustomCalendar(true);
      setCustomRange({
        from: new Date(dateRange.since),
        to: new Date(dateRange.until)
      });
    } else {
      setShowCustomCalendar(false);
    }
  }, [open, selectedOption, dateRange]);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Выберите период</DialogTitle>
        </DialogHeader>
        
        {!showCustomCalendar ? (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-wrap gap-2">
              <Toggle 
                pressed={selectedOption === 'today'}
                onPressedChange={() => selectedOption !== 'today' && handleSelectOption('today')}
                variant="outline"
                className="flex-1"
              >
                Сегодня
              </Toggle>
              <Toggle 
                pressed={selectedOption === 'yesterday'}
                onPressedChange={() => selectedOption !== 'yesterday' && handleSelectOption('yesterday')}
                variant="outline"
                className="flex-1"
              >
                Вчера
              </Toggle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle 
                pressed={selectedOption === 'last7days'}
                onPressedChange={() => selectedOption !== 'last7days' && handleSelectOption('last7days')}
                variant="outline"
                className="flex-1"
              >
                Последние 7 дней
              </Toggle>
              <Toggle 
                pressed={selectedOption === 'last30days'}
                onPressedChange={() => selectedOption !== 'last30days' && handleSelectOption('last30days')}
                variant="outline"
                className="flex-1"
              >
                Последние 30 дней
              </Toggle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle 
                pressed={selectedOption === 'custom'}
                onPressedChange={() => selectedOption !== 'custom' && handleSelectOption('custom')}
                variant="outline"
                className="flex-1"
              >
                <CalendarDays className="mr-2 h-4 w-4" />
                Настраиваемый период
              </Toggle>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-3">
                Выберите диапазон дат на календаре:
              </p>
              {customRange.from && customRange.to && (
                <p className="text-sm font-medium">
                  {format(customRange.from, 'dd.MM.yyyy')} — {format(customRange.to, 'dd.MM.yyyy')}
                </p>
              )}
            </div>
            <Calendar
              mode="range"
              selected={{ from: customRange.from, to: customRange.to }}
              onSelect={(range) => setCustomRange({ from: range?.from, to: range?.to })}
              numberOfMonths={1}
              defaultMonth={customRange.from || new Date()}
            />
          </div>
        )}
        
        <DialogFooter>
          {showCustomCalendar ? (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleCustomRangeCancel} className="flex-1">
                Отмена
              </Button>
              <Button 
                onClick={handleCustomRangeApply} 
                disabled={!customRange.from || !customRange.to}
                className="flex-1"
              >
                Применить
              </Button>
            </div>
          ) : (
            <Button onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DateRangePicker;
