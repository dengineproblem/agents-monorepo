import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { z } from 'zod';

// Схемы валидации
const PhoneNumberSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/, {
  message: 'Номер должен быть в международном формате, например: +12345678901'
});

const CreateWhatsAppNumberSchema = z.object({
  userAccountId: z.string().uuid(),
  phone_number: PhoneNumberSchema,
  label: z.string().max(100).optional(),
  is_default: z.boolean().default(false),
});

const UpdateWhatsAppNumberSchema = z.object({
  label: z.string().max(100).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export default async function whatsappNumbersRoutes(app: FastifyInstance) {
  
  // GET /whatsapp-numbers - получить список номеров пользователя
  app.get('/whatsapp-numbers', async (request, reply) => {
    const { userAccountId } = request.query as { userAccountId?: string };
    
    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }
    
    try {
      const { data, error } = await supabase
        .from('whatsapp_phone_numbers')
        .select('*')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      
      return reply.send({ numbers: data || [] });
    } catch (error: any) {
      app.log.error('Error fetching WhatsApp numbers:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch numbers' });
    }
  });
  
  // POST /whatsapp-numbers - добавить новый номер
  app.post('/whatsapp-numbers', async (request, reply) => {
    try {
      const body = CreateWhatsAppNumberSchema.parse(request.body);
      
      // Проверка существования номера
      const { data: existing } = await supabase
        .from('whatsapp_phone_numbers')
        .select('id')
        .eq('user_account_id', body.userAccountId)
        .eq('phone_number', body.phone_number)
        .maybeSingle();
      
      if (existing) {
        return reply.status(409).send({ error: 'Этот номер уже добавлен' });
      }
      
      // Создание номера
      const { data, error } = await supabase
        .from('whatsapp_phone_numbers')
        .insert({
          user_account_id: body.userAccountId,
          phone_number: body.phone_number,
          label: body.label || null,
          is_default: body.is_default,
          is_active: true,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      return reply.status(201).send({ number: data });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors[0].message });
      }
      app.log.error('Error creating WhatsApp number:', error);
      return reply.status(500).send({ error: error.message || 'Failed to create number' });
    }
  });
  
  // PUT /whatsapp-numbers/:id - обновить номер
  app.put('/whatsapp-numbers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const body = UpdateWhatsAppNumberSchema.parse(request.body);
      
      const { data, error } = await supabase
        .from('whatsapp_phone_numbers')
        .update(body)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      if (!data) {
        return reply.status(404).send({ error: 'Number not found' });
      }
      
      return reply.send({ number: data });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors[0].message });
      }
      app.log.error('Error updating WhatsApp number:', error);
      return reply.status(500).send({ error: error.message || 'Failed to update number' });
    }
  });
  
  // DELETE /whatsapp-numbers/:id - удалить номер
  app.delete('/whatsapp-numbers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userAccountId } = request.query as { userAccountId?: string };
    
    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }
    
    try {
      // Проверка использования в направлениях
      const { data: usedInDirections } = await supabase
        .from('account_directions')
        .select('id, name')
        .eq('whatsapp_phone_number_id', id)
        .limit(5);
      
      if (usedInDirections && usedInDirections.length > 0) {
        return reply.status(409).send({
          error: 'Номер используется в направлениях',
          directions: usedInDirections.map((d: any) => d.name),
        });
      }
      
      // Удаление
      const { error } = await supabase
        .from('whatsapp_phone_numbers')
        .delete()
        .eq('id', id)
        .eq('user_account_id', userAccountId);
      
      if (error) throw error;
      
      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error('Error deleting WhatsApp number:', error);
      return reply.status(500).send({ error: error.message || 'Failed to delete number' });
    }
  });
  
  // GET /whatsapp-numbers/default - получить дефолтный номер пользователя
  app.get('/whatsapp-numbers/default', async (request, reply) => {
    const { userAccountId } = request.query as { userAccountId?: string };
    
    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }
    
    try {
      // 1. Пробуем найти дефолтный в новой таблице
      const { data: defaultNumber } = await supabase
        .from('whatsapp_phone_numbers')
        .select('phone_number')
        .eq('user_account_id', userAccountId)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      
      if (defaultNumber) {
        return reply.send({ phone_number: defaultNumber.phone_number, source: 'whatsapp_phone_numbers' });
      }
      
      // 2. Fallback на старый номер из user_accounts
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('whatsapp_phone_number')
        .eq('id', userAccountId)
        .maybeSingle();
      
      if (userAccount?.whatsapp_phone_number) {
        return reply.send({ phone_number: userAccount.whatsapp_phone_number, source: 'user_accounts' });
      }
      
      // 3. Нет номера
      return reply.send({ phone_number: null, source: null });
    } catch (error: any) {
      app.log.error('Error fetching default WhatsApp number:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch default number' });
    }
  });
}

