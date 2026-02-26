import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { CarouselTab } from '@/components/creatives/CarouselTab';
import { userProfileApi } from '@/services/userProfileApi';
import { useDirections } from '@/hooks/useDirections';
import { useAppContext } from '@/context/AppContext';

const CarouselTest = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState(0);
  const { currentAdAccountId, multiAccountEnabled, platform } = useAppContext();
  // Загрузка направлений с фильтрацией по currentAdAccountId для мультиаккаунтности
  const directionsPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';
  const { directions } = useDirections(userId, currentAdAccountId, directionsPlatform);

  useEffect(() => {
    const fetchUser = async () => {
      const storedUser = localStorage.getItem('user');
      const localUser = storedUser ? JSON.parse(storedUser) : null;
      if (localUser?.id) {
        setUserId(localUser.id);

        try {
          const data = await userProfileApi.fetchProfile(localUser.id);
          if (data) {
            setCreativeGenerationsAvailable(data.creative_generations_available || 0);
          }
        } catch (err) {
          console.error('Ошибка загрузки профиля:', err);
        }
      }
    };
    fetchUser();
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <PageHero
        title="Тест каруселей"
        description="Тестирование нового функционала генерации каруселей"
      />

      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-6">
          <CarouselTab
            userId={userId}
            currentAdAccountId={currentAdAccountId}
            multiAccountEnabled={multiAccountEnabled}
            creativeGenerationsAvailable={creativeGenerationsAvailable}
            setCreativeGenerationsAvailable={setCreativeGenerationsAvailable}
            directions={directions}
          />
        </div>
      </div>
    </div>
  );
};

export default CarouselTest;
