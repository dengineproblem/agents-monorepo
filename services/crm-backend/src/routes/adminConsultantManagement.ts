import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { notifyConsultantAboutNewLead } from '../lib/consultantNotifications.js';

/**
 * Admin routes для управления консультантами и лидами
 */
export async function adminConsultantManagementRoutes(app: FastifyInstance) {
  /**
   * PUT /admin/leads/:leadId/reassign
   * Переназначить лида другому консультанту (только для админа)
   */
  app.put('/admin/leads/:leadId/reassign', async (request, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const { newConsultantId } = request.body as { newConsultantId: string };
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      if (!newConsultantId) {
        return reply.status(400).send({ error: 'newConsultantId is required' });
      }

      // Проверяем что лид существует
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, assigned_consultant_id, contact_name, contact_phone')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Проверяем что новый консультант существует и активен
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, is_active')
        .eq('id', newConsultantId)
        .single();

      if (consultantError || !consultant) {
        return reply.status(404).send({ error: 'Consultant not found' });
      }

      if (!consultant.is_active) {
        return reply.status(400).send({ error: 'Consultant is not active' });
      }

      const oldConsultantId = lead.assigned_consultant_id;

      // Обновляем назначение
      const { data: updatedLead, error: updateError } = await supabase
        .from('dialog_analysis')
        .update({ assigned_consultant_id: newConsultantId })
        .eq('id', leadId)
        .select()
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to reassign lead');
        return reply.status(500).send({ error: updateError.message });
      }

      // Логируем изменение
      app.log.info({
        leadId,
        oldConsultantId,
        newConsultantId,
        adminId: userAccountId,
        leadContact: lead.contact_name || lead.contact_phone
      }, 'Lead reassigned by admin');

      // Отправляем уведомление новому консультанту
      notifyConsultantAboutNewLead(newConsultantId, leadId).catch(err => {
        app.log.error({ error: err }, 'Failed to notify consultant about new lead');
      });

      return reply.send({
        success: true,
        lead: updatedLead,
        message: `Лид переназначен консультанту ${consultant.name}`
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error reassigning lead');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/consultants/stats
   * Получить статистику по всем консультантам (только для админа)
   */
  app.get('/admin/consultants/stats', async (request, reply) => {
    try {
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // Получаем статистику из view
      const { data, error } = await supabase
        .from('consultant_dashboard_stats')
        .select('*')
        .order('total_leads', { ascending: false });

      if (error) {
        app.log.error({ error }, 'Failed to fetch consultant stats');
        return reply.status(500).send({ error: error.message });
      }

      // Дополнительно получаем информацию о консультантах
      const { data: consultants, error: consultantsError } = await supabase
        .from('consultants')
        .select(`
          id,
          name,
          phone,
          email,
          specialization,
          is_active,
          user_account_id,
          user_accounts!inner(id, username, role)
        `);

      if (consultantsError) {
        app.log.error({ error: consultantsError }, 'Failed to fetch consultants');
        return reply.status(500).send({ error: consultantsError.message });
      }

      // Объединяем данные
      const statsWithInfo = (data || []).map(stat => {
        const consultant = consultants?.find(c => c.id === stat.consultant_id);
        return {
          ...stat,
          consultant_info: consultant || null
        };
      });

      return reply.send(statsWithInfo);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching consultant stats');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/leads/unassigned
   * Получить лидов без назначенного консультанта (только для админа)
   */
  app.get('/admin/leads/unassigned', async (request, reply) => {
    try {
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { data, error } = await supabase
        .from('dialog_analysis')
        .select('*')
        .is('assigned_consultant_id', null)
        .order('last_message', { ascending: false })
        .limit(100);

      if (error) {
        app.log.error({ error }, 'Failed to fetch unassigned leads');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching unassigned leads');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /admin/consultants/:consultantId/accepts-new-leads
   * Включить/выключить консультанта от автоматического распределения новых лидов
   */
  app.put('/admin/consultants/:consultantId/accepts-new-leads', async (request, reply) => {
    try {
      const { consultantId } = request.params as { consultantId: string };
      const { acceptsNewLeads } = request.body as { acceptsNewLeads: boolean };
      const userAccountId = request.headers['x-user-id'] as string;

      // Проверяем что пользователь - админ
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('role, is_tech_admin')
        .eq('id', userAccountId)
        .single();

      if (userError || (!userAccount?.is_tech_admin && userAccount?.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      if (typeof acceptsNewLeads !== 'boolean') {
        return reply.status(400).send({ error: 'acceptsNewLeads must be a boolean' });
      }

      // Проверяем что консультант существует
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, is_active, accepts_new_leads')
        .eq('id', consultantId)
        .single();

      if (consultantError || !consultant) {
        return reply.status(404).send({ error: 'Consultant not found' });
      }

      // Обновляем флаг
      const { data: updatedConsultant, error: updateError } = await supabase
        .from('consultants')
        .update({ accepts_new_leads: acceptsNewLeads })
        .eq('id', consultantId)
        .select('id, name, is_active, accepts_new_leads')
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to update consultant accepts_new_leads');
        return reply.status(500).send({ error: updateError.message });
      }

      // Логируем изменение
      app.log.info({
        consultantId,
        consultantName: consultant.name,
        oldValue: consultant.accepts_new_leads,
        newValue: acceptsNewLeads,
        adminId: userAccountId
      }, 'Consultant accepts_new_leads updated by admin');

      return reply.send({
        success: true,
        consultant: updatedConsultant,
        message: acceptsNewLeads
          ? `Консультант ${consultant.name} теперь принимает новых лидов`
          : `Консультант ${consultant.name} отключён от распределения новых лидов`
      });
    } catch (error: any) {
      app.log.error({ error }, 'Error updating consultant accepts_new_leads');
      return reply.status(500).send({ error: error.message });
    }
  });
}
