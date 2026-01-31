import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { consultantAuthMiddleware, ConsultantAuthRequest, adminOnlyMiddleware } from '../middleware/consultantAuth.js';

/**
 * Отправить учетные данные консультанту через WhatsApp
 */
async function sendConsultantCredentials(
  consultantPhone: string,
  username: string,
  password: string,
  instanceName: string
): Promise<boolean> {
  try {
    const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

    // Форматируем телефон для WhatsApp
    let formattedPhone = consultantPhone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('7') && formattedPhone.length === 10) {
      formattedPhone = '7' + formattedPhone;
    }

    const message = `Добро пожаловать в систему консультаций!

Ваш логин: ${username}
Ваш временный пароль: ${password}

Войдите по адресу: ${process.env.FRONTEND_URL || 'https://crm.example.com'}/login

После входа рекомендуем сменить пароль в разделе "Профиль"`;

    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: `${formattedPhone}@s.whatsapp.net`,
        text: message
      })
    });

    if (!response.ok) {
      console.error('[sendConsultantCredentials] Evolution API error:', response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[sendConsultantCredentials] Error sending WhatsApp message:', error);
    return false;
  }
}

/**
 * Routes для управления консультантами
 */
export async function consultantsRoutes(app: FastifyInstance) {
  // Применяем middleware авторизации ко всем роутам
  app.addHook('preHandler', consultantAuthMiddleware);

  /**
   * GET /consultants
   * Получить список консультантов
   */
  app.get('/consultants', async (request: ConsultantAuthRequest, reply) => {
    try {
      const userAccountId = request.userAccountId;

      if (!userAccountId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { data, error } = await supabase
        .from('consultants')
        .select(`
          *,
          user_account:user_accounts(username, role)
        `)
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false });

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultants');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultants');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultants
   * Создать нового консультанта с автосозданием user_account
   */
  app.post('/consultants', async (request: ConsultantAuthRequest, reply) => {
    try {
      // Только админы могут создавать консультантов
      if (request.userRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin access only' });
      }

      const { name, email, phone, specialization, createAccount } = request.body as {
        name: string;
        email?: string;
        phone: string;
        specialization?: string;
        createAccount?: boolean; // флаг автосоздания аккаунта
      };

      const userAccountId = request.userAccountId;

      if (!userAccountId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (!name || !phone) {
        return reply.status(400).send({ error: 'Name and phone are required' });
      }

      let consultantUserAccountId: string | null = null;
      let credentials: { username: string; password: string } | null = null;

      // Если нужно создать аккаунт для консультанта
      if (createAccount) {
        // Генерируем логин из телефона (только цифры)
        const username = phone.replace(/\D/g, '');

        // Генерируем временный пароль (первые 4 цифры телефона)
        const phoneDigits = phone.replace(/\D/g, '');
        const password = phoneDigits.substring(0, 4);

        if (password.length < 4) {
          return reply.status(400).send({
            error: 'Phone number too short for password generation'
          });
        }

        // Проверяем что username уникален
        const { data: existingUser } = await supabase
          .from('user_accounts')
          .select('id')
          .eq('username', username)
          .single();

        if (existingUser) {
          return reply.status(400).send({
            error: 'Account with this phone already exists'
          });
        }

        // Создаем user_account
        const { data: newUserAccount, error: userError } = await supabase
          .from('user_accounts')
          .insert({
            username,
            password, // TODO: в будущем добавить хеширование
            role: 'consultant'
          })
          .select()
          .single();

        if (userError) {
          app.log.error({ error: userError }, 'Failed to create user_account');
          return reply.status(500).send({
            error: 'Failed to create user account',
            details: userError.message
          });
        }

        consultantUserAccountId = newUserAccount.id;
        credentials = { username, password };
      }

      // Создаем консультанта
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .insert({
          name,
          email,
          phone,
          specialization,
          user_account_id: createAccount ? consultantUserAccountId : userAccountId,
          is_active: true
        })
        .select()
        .single();

      if (consultantError) {
        app.log.error({ error: consultantError }, 'Failed to create consultant');

        // Откатываем создание user_account если консультант не создан
        if (consultantUserAccountId) {
          await supabase
            .from('user_accounts')
            .delete()
            .eq('id', consultantUserAccountId);
        }

        return reply.status(500).send({
          error: 'Failed to create consultant',
          details: consultantError.message
        });
      }

      // Отправляем учетные данные в WhatsApp если аккаунт создан
      if (createAccount && credentials) {
        // Получаем instance_name из user_account
        const { data: userAccount } = await supabase
          .from('user_accounts')
          .select('evolution_instance')
          .eq('id', userAccountId)
          .single();

        const instanceName = userAccount?.evolution_instance || 'default';

        // Отправляем сообщение асинхронно (не блокируем ответ)
        sendConsultantCredentials(
          phone,
          credentials.username,
          credentials.password,
          instanceName
        ).catch(err => {
          app.log.error({ error: err }, 'Failed to send consultant credentials via WhatsApp');
        });
      }

      return reply.status(201).send({
        consultant,
        credentials: createAccount ? credentials : undefined,
        message: createAccount
          ? 'Consultant created, credentials sent to WhatsApp'
          : 'Consultant created'
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error creating consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultants/:id
   * Обновить консультанта
   */
  app.put('/consultants/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { name, email, phone, specialization, is_active } = request.body as {
        name?: string;
        email?: string;
        phone?: string;
        specialization?: string;
        is_active?: boolean;
      };

      const { data, error } = await supabase
        .from('consultants')
        .update({
          name,
          email,
          phone,
          specialization,
          is_active
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error updating consultant');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultants/:id
   * Удалить консультанта
   */
  app.delete('/consultants/:id', async (request: ConsultantAuthRequest, reply) => {
    try {
      const { id } = request.params as { id: string };

      // Проверяем есть ли закрепленные леды
      const { data: leads, error: leadsError } = await supabase
        .from('dialog_analysis')
        .select('id')
        .eq('assigned_consultant_id', id)
        .limit(1);

      if (leadsError) {
        app.log.error({ error: leadsError }, 'Failed to check assigned leads');
        return reply.status(500).send({ error: leadsError.message });
      }

      if (leads && leads.length > 0) {
        return reply.status(400).send({
          error: 'Cannot delete consultant with assigned leads',
          details: 'Переназначьте лидов другому консультанту перед удалением'
        });
      }

      const { error } = await supabase
        .from('consultants')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ error }, 'Failed to delete consultant');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting consultant');
      return reply.status(500).send({ error: error.message });
    }
  });
}
