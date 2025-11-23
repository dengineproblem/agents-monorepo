import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Video } from 'lucide-react';

export const VideoScriptsTab: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
            <Video className="h-8 w-8 text-gray-400" />
          </div>
          <CardTitle>Видео-сценарии</CardTitle>
          <CardDescription>
            Генерация текстов и сценариев для видео-креативов
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-gray-500">
            Эта функция будет доступна в следующем обновлении
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
