import { FastifyInstance } from 'fastify';
import { 
  selectLeadsForReactivation, 
  distributeMessages,
  scheduleReactivationMessages,
  getReactivationCampaignStatus
} from '../lib/reactivationEngine.js';

export default async function reactivationRoutes(app: FastifyInstance) {
  
  /**
   * GET /chatbot/reactivation/status
   * Получить статус текущей кампании реанимации
   */
  app.get('/chatbot/reactivation/status', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };
      
      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }
      
      const status = await getReactivationCampaignStatus(userAccountId);
      
      return reply.send(status);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error getting reactivation status');
      return reply.status(500).send({ error: error.message });
    }
  });
  
  /**
   * POST /chatbot/reactivation/start
   * Запустить кампанию реанимации вручную
   */
  app.post('/chatbot/reactivation/start', async (request, reply) => {
    try {
      const { userAccountId, limit } = request.body as {
        userAccountId: string;
        limit?: number;
      };
      
      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }
      
      const leadLimit = limit || 300;
      
      // 1. Выбрать лидов
      const leads = await selectLeadsForReactivation({
        userAccountId,
        limit: leadLimit
      });
      
      if (leads.length === 0) {
        return reply.send({
          success: true,
          message: 'No leads available for reactivation',
          leadsScheduled: 0
        });
      }
      
      // 2. Распределить по расписанию
      const schedule = distributeMessages(leads, {
        startHour: 10,
        endHour: 20,
        daysOfWeek: [1, 2, 3, 4, 5]
      });
      
      // 3. Добавить в очередь
      await scheduleReactivationMessages(schedule);
      
      app.log.info({ 
        userAccountId, 
        leadsScheduled: schedule.length 
      }, 'Manual reactivation campaign started');
      
      return reply.send({
        success: true,
        message: 'Reactivation campaign started',
        leadsScheduled: schedule.length,
        topLeads: leads.slice(0, 10).map(l => ({
          id: l.id,
          contactPhone: l.contact_phone,
          contactName: l.contact_name,
          funnelStage: l.funnel_stage,
          score: l.reactivation_score
        }))
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error starting reactivation campaign');
      return reply.status(500).send({ error: error.message });
    }
  });
  
  /**
   * GET /chatbot/reactivation/queue
   * Получить очередь запланированных сообщений
   */
  app.get('/chatbot/reactivation/queue', async (request, reply) => {
    try {
      const { userAccountId, limit } = request.query as {
        userAccountId: string;
        limit?: string;
      };
      
      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }
      
      const topLeads = await selectLeadsForReactivation({
        userAccountId,
        limit: parseInt(limit || '50')
      });
      
      return reply.send({
        leads: topLeads.map(l => ({
          id: l.id,
          contactPhone: l.contact_phone,
          contactName: l.contact_name,
          funnelStage: l.funnel_stage,
          interestLevel: l.interest_level,
          reactivationAttempts: l.reactivation_attempts,
          score: l.reactivation_score,
          lastMessage: l.last_message?.substring(0, 100)
        })),
        total: topLeads.length
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error getting reactivation queue');
      return reply.status(500).send({ error: error.message });
    }
  });
  
  /**
   * DELETE /chatbot/reactivation/cancel
   * Отменить все запланированные рассылки для пользователя
   */
  app.delete('/chatbot/reactivation/cancel', async (request, reply) => {
    try {
      const { userAccountId } = request.body as { userAccountId: string };
      
      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }
      
      // TODO: Реализовать удаление только для конкретного пользователя
      // Пока удаляем всю очередь (для MVP приемлемо)
      // await redis.del('reactivation_queue');
      
      app.log.info({ userAccountId }, 'Reactivation campaign cancelled');
      
      return reply.send({
        success: true,
        message: 'Campaign cancelled (feature in development)'
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error cancelling campaign');
      return reply.status(500).send({ error: error.message });
    }
  });
}

