import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { CarouselTab } from '@/components/creatives/CarouselTab';
import { supabase } from '@/integrations/supabase/client';
import { useDirections } from '@/hooks/useDirections';
import { useAppContext } from '@/context/AppContext';

const CarouselTest = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [creativeGenerationsAvailable, setCreativeGenerationsAvailable] = useState(0);
  const { currentAdAccountId, multiAccountEnabled } = useAppContext();
  // Загрузка направлений с фильтрацией по currentAdAccountId для мультиаккаунтности
  const { directions } = useDirections(userId, currentAdAccountId);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);

        const { data } = await supabase
          .from('user_accounts')
          .select('creative_generations_available')
          .eq('id', user.id)
          .single();

        if (data) {
          setCreativeGenerationsAvailable(data.creative_generations_available || 0);
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
