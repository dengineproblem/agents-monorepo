'use client';

import React from 'react';
import { MoonIcon, SunIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function Header() {
  const { systemTheme, theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleRefresh = () => {
    window.location.reload();
  };

  const renderThemeChanger = () => {
    if (!mounted) return null;

    const currentTheme = theme === 'system' ? systemTheme : theme;

    if (currentTheme === 'dark') {
      return (
        <SunIcon
          className="h-7 w-7 cursor-pointer hover:text-gray-500 transition-colors"
          role="button"
          onClick={() => setTheme('light')}
        />
      );
    } else {
      return (
        <MoonIcon
          className="h-7 w-7 cursor-pointer hover:text-gray-500 transition-colors"
          role="button"
          onClick={() => setTheme('dark')}
        />
      );
    }
  };

  return (
    <header className="flex items-center justify-end gap-4 p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex items-center space-x-4 sm:space-x-6">
        <button
          onClick={handleRefresh}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
          aria-label="Обновить страницу"
        >
          <ArrowPathIcon className="h-7 w-7" />
        </button>
        {renderThemeChanger()}
      </div>
    </header>
  );
}



