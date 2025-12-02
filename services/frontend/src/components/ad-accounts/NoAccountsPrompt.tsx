import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Plus, ArrowRight } from 'lucide-react';
import { CreateAdAccountDialog } from './CreateAdAccountDialog';

interface NoAccountsPromptProps {
  className?: string;
}

export function NoAccountsPrompt({ className }: NoAccountsPromptProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <Card className={className}>
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Добро пожаловать в мультиаккаунтный режим!</CardTitle>
          <CardDescription className="text-base">
            Для начала работы создайте первый рекламный аккаунт
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            Вы сможете управлять до 5 рекламными аккаунтами Facebook/Instagram
            с разными настройками, направлениями и креативами.
          </p>
          <Button size="lg" onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-5 w-5" />
            Создать первый аккаунт
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <CreateAdAccountDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
      />
    </>
  );
}

export default NoAccountsPrompt;
