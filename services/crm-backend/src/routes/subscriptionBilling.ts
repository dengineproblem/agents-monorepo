import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  applySubscriptionToUserAccount,
  getAlmatyTodayDateString,
  isTechAdminUser,
  normalizePhone,
  processSubscriptionBillingSweep
} from '../lib/subscriptionBilling.js';
import { consultantAuthMiddleware, ConsultantAuthRequest } from '../middleware/consultantAuth.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSubscriptionSaleSchema = z.object({
  consultant_id: z.string().uuid().optional(),
  client_name: z.string().max(255).optional(),
  client_phone: z.string().min(5),
  product_id: z.string().uuid().optional(),
  custom_product_name: z.string().max(255).optional(),
  amount: z.number().positive().optional(),
  months: z.number().int().positive().optional(),
  sale_date: dateSchema.optional(),
  comment: z.string().max(2000).optional()
}).superRefine((value, ctx) => {
  const hasProduct = Boolean(value.product_id);
  const hasCustom = Boolean(value.custom_product_name);

  if (!hasProduct && !hasCustom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Specify product_id or custom_product_name'
    });
  }

  if (hasProduct && hasCustom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use either product_id or custom_product_name, not both'
    });
  }

  if (hasCustom && value.amount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'amount is required for custom sale'
    });
  }
});

const linkSaleToUserSchema = z.object({
  user_account_id: z.string().uuid(),
  persist_link: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional()
});

const manualSubscriptionSetSchema = z.object({
  months: z.number().int().positive(),
  amount: z.number().min(0),
  comment: z.string().max(2000).optional(),
  source_sale_id: z.string().uuid().optional(),
  start_date: dateSchema.optional(),
  override: z.boolean().optional()
});

const createPhoneLinkSchema = z.object({
  phone: z.string().min(5),
  user_account_id: z.string().uuid(),
  active: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional()
});

function sanitizeSearchTerm(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&').trim();
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireTechAdmin(request: ConsultantAuthRequest, reply: FastifyReply): Promise<boolean> {
  const userAccountId = request.userAccountId;
  if (!userAccountId) {
    await reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  const allowed = await isTechAdminUser(userAccountId);
  if (!allowed) {
    await reply.status(403).send({ error: 'Tech admin access required' });
    return false;
  }

  return true;
}

function resolveConsultantId(request: ConsultantAuthRequest, requestedConsultantId?: string): string | null {
  if (request.userRole === 'consultant') {
    return request.consultant?.id || null;
  }

  if (request.userRole === 'admin') {
    return requestedConsultantId || null;
  }

  return null;
}

export async function subscriptionBillingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', consultantAuthMiddleware);

  app.get('/subscription/products', async (request: ConsultantAuthRequest, reply) => {
    try {
      const includeInactive = ((request.query as any)?.include_inactive as string | undefined) === 'true';

      let query = supabase
        .from('crm_subscription_products')
        .select('*')
        .order('months', { ascending: true });

      if (!includeInactive) {
        query = query.eq('active', true);
      }

      const { data, error } = await query;

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.get('/subscription/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const query = request.query as any;
      const requestedConsultantId = query?.consultant_id as string | undefined;
      const status = query?.status as string | undefined;
      const search = query?.search as string | undefined;
      const saleKind = query?.sale_kind as string | undefined;
      const includeUser = (query?.include_user as string | undefined) === 'true';
      const limit = Math.min(parseInt(query?.limit || '50', 10), 200);
      const offset = Math.max(parseInt(query?.offset || '0', 10), 0);

      const consultantId = resolveConsultantId(request, requestedConsultantId);
      if (request.userRole === 'consultant' && !consultantId) {
        return reply.status(403).send({ error: 'Consultant profile not found' });
      }

      const selectClause = includeUser
        ? '*, user_accounts(id, username, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, tarif, tarif_expires, is_active)'
        : '*';

      let dbQuery = supabase
        .from('crm_subscription_sales')
        .select(selectClause)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (request.userRole === 'consultant' && consultantId) {
        dbQuery = dbQuery.eq('consultant_id', consultantId);
      }

      if (request.userRole === 'admin' && consultantId) {
        dbQuery = dbQuery.eq('consultant_id', consultantId);
      }

      if (status) {
        dbQuery = dbQuery.eq('status', status);
      }

      if (saleKind) {
        dbQuery = dbQuery.eq('sale_kind', saleKind);
      }

      if (search) {
        const term = sanitizeSearchTerm(search);
        if (term.length > 0) {
          dbQuery = dbQuery.or(`client_phone.ilike.%${term}%,client_name.ilike.%${term}%`);
        }
      }

      const { data, error } = await dbQuery;
      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({ sales: data || [], limit, offset });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.get('/admin/subscriptions/active-users', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const query = request.query as any;
      const q = (query?.search as string | undefined)?.trim();
      const includeInactive = (query?.include_inactive as string | undefined) === 'true';
      const limit = Math.min(parseInt(query?.limit || '50', 10), 200);
      const offset = Math.max(parseInt(query?.offset || '0', 10), 0);
      const todayAlmaty = getAlmatyTodayDateString();

      let dbQuery = supabase
        .from('user_accounts')
        .select('id, username, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, tarif, tarif_expires, tarif_renewal_cost, is_active, created_at')
        .ilike('tarif', 'subscription_%')
        .order('tarif_expires', { ascending: true })
        .range(offset, offset + limit - 1);

      if (!includeInactive) {
        dbQuery = dbQuery.eq('is_active', true).gte('tarif_expires', todayAlmaty);
      }

      if (q && q.length > 0) {
        const term = sanitizeSearchTerm(q);
        const orFilters = [
          `username.ilike.%${term}%`,
          `telegram_id.ilike.%${term}%`,
          `telegram_id_2.ilike.%${term}%`,
          `telegram_id_3.ilike.%${term}%`,
          `telegram_id_4.ilike.%${term}%`
        ];
        if (isUuidLike(term)) {
          orFilters.push(`id.eq.${term}`);
        }
        dbQuery = dbQuery.or(orFilters.join(','));
      }

      const { data, error } = await dbQuery;
      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({ users: data || [], limit, offset });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/subscription/sales', async (request: ConsultantAuthRequest, reply) => {
    try {
      const body = createSubscriptionSaleSchema.parse(request.body);
      const consultantId = resolveConsultantId(request, body.consultant_id);

      if (request.userRole === 'consultant' && !consultantId) {
        return reply.status(403).send({ error: 'Consultant profile not found' });
      }

      const normalizedPhone = normalizePhone(body.client_phone);
      const saleDate = body.sale_date || new Date().toISOString().slice(0, 10);

      let saleKind: 'subscription' | 'custom';
      let productId: string | null = null;
      let customProductName: string | null = null;
      let amount: number;
      let months: number | null;
      let currency = 'KZT';

      if (body.product_id) {
        const { data: product, error: productError } = await supabase
          .from('crm_subscription_products')
          .select('id, months, price, currency, active')
          .eq('id', body.product_id)
          .single();

        if (productError || !product) {
          return reply.status(404).send({ error: 'Subscription product not found' });
        }

        if (!product.active) {
          return reply.status(400).send({ error: 'Subscription product is inactive' });
        }

        saleKind = 'subscription';
        productId = product.id;
        amount = Number(product.price);
        months = product.months;
        currency = product.currency || 'KZT';
      } else {
        saleKind = 'custom';
        customProductName = body.custom_product_name || null;
        amount = Number(body.amount);
        months = body.months || null;
      }

      const insertPayload = {
        consultant_id: consultantId,
        client_name: body.client_name || null,
        client_phone: body.client_phone,
        normalized_phone: normalizedPhone,
        product_id: productId,
        custom_product_name: customProductName,
        amount,
        months,
        currency,
        sale_kind: saleKind,
        status: 'pending_link',
        sale_date: saleDate,
        comment: body.comment || null,
        source: 'crm'
      };

      const { data: createdSale, error: insertError } = await supabase
        .from('crm_subscription_sales')
        .insert(insertPayload)
        .select('*')
        .single();

      if (insertError || !createdSale) {
        return reply.status(500).send({ error: insertError?.message || 'Failed to create sale' });
      }

      return reply.send(createdSale);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/subscription/sales/:saleId/link-user', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const { saleId } = request.params as { saleId: string };
      const body = linkSaleToUserSchema.parse(request.body);
      const actorUserAccountId = request.userAccountId as string;

      const { data: sale, error: saleError } = await supabase
        .from('crm_subscription_sales')
        .select('id, client_phone, normalized_phone, status')
        .eq('id', saleId)
        .single();

      if (saleError || !sale) {
        return reply.status(404).send({ error: 'Sale not found' });
      }

      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('id, username, is_tech_admin')
        .eq('id', body.user_account_id)
        .single();

      if (userError || !user || user.is_tech_admin) {
        return reply.status(404).send({ error: 'User account not found' });
      }

      const normalizedPhone = sale.normalized_phone || normalizePhone(sale.client_phone);

      const { data: updatedSale, error: updateSaleError } = await supabase
        .from('crm_subscription_sales')
        .update({
          user_account_id: body.user_account_id,
          status: 'linked',
          linked_by: actorUserAccountId,
          linked_at: new Date().toISOString()
        })
        .eq('id', saleId)
        .select('*')
        .single();

      if (updateSaleError || !updatedSale) {
        return reply.status(500).send({ error: updateSaleError?.message || 'Failed to link sale to user' });
      }

      if (body.persist_link) {
        const { error: upsertLinkError } = await supabase
          .from('crm_phone_user_links')
          .upsert({
            normalized_phone: normalizedPhone,
            user_account_id: body.user_account_id,
            linked_by: actorUserAccountId,
            active: true,
            notes: body.notes || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'normalized_phone,user_account_id'
          });

        if (upsertLinkError) {
          return reply.status(500).send({ error: upsertLinkError.message });
        }
      }

      return reply.send(updatedSale);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/subscription/sales/:saleId/apply', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const { saleId } = request.params as { saleId: string };
      const actorUserAccountId = request.userAccountId as string;

      const { data: sale, error: saleError } = await supabase
        .from('crm_subscription_sales')
        .select('id, user_account_id, sale_kind, months, amount, status, comment')
        .eq('id', saleId)
        .single();

      if (saleError || !sale) {
        return reply.status(404).send({ error: 'Sale not found' });
      }

      if (!sale.user_account_id) {
        return reply.status(400).send({ error: 'Sale is not linked to user account' });
      }

      if (sale.status === 'applied') {
        return reply.send({ success: true, message: 'Sale already applied', sale });
      }

      if (sale.sale_kind !== 'subscription') {
        return reply.status(400).send({
          error: 'Custom sale cannot be auto-applied as subscription. Use manual set endpoint.'
        });
      }

      if (!sale.months || sale.months <= 0) {
        return reply.status(400).send({ error: 'Sale months is missing or invalid' });
      }

      const applyResult = await applySubscriptionToUserAccount({
        userAccountId: sale.user_account_id,
        months: sale.months,
        renewalCost: Number(sale.amount),
        actorUserAccountId,
        source: 'crm_sale',
        sourceSaleId: sale.id,
        comment: sale.comment || undefined
      });

      const { data: updatedSale, error: updateError } = await supabase
        .from('crm_subscription_sales')
        .update({
          status: 'applied',
          applied_by: actorUserAccountId,
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sale.id)
        .select('*')
        .single();

      if (updateError || !updatedSale) {
        return reply.status(500).send({ error: updateError?.message || 'Failed to mark sale as applied' });
      }

      return reply.send({ success: true, sale: updatedSale, applyResult });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/subscription/sales/:saleId/cancel', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const { saleId } = request.params as { saleId: string };

      const { data: sale, error: saleError } = await supabase
        .from('crm_subscription_sales')
        .select('id, status')
        .eq('id', saleId)
        .single();

      if (saleError || !sale) {
        return reply.status(404).send({ error: 'Sale not found' });
      }

      if (sale.status === 'cancelled') {
        return reply.send({ success: true, sale, message: 'Sale already cancelled' });
      }

      const { data: updatedSale, error: updateError } = await supabase
        .from('crm_subscription_sales')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', saleId)
        .select('*')
        .single();

      if (updateError || !updatedSale) {
        return reply.status(500).send({ error: updateError?.message || 'Failed to cancel sale' });
      }

      return reply.send({
        success: true,
        sale: updatedSale,
        warning: 'Subscription changes are not reverted автоматически. При необходимости скорректируйте срок вручную.'
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/admin/subscriptions/users/:userAccountId/set', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const { userAccountId } = request.params as { userAccountId: string };
      const body = manualSubscriptionSetSchema.parse(request.body);

      const result = await applySubscriptionToUserAccount({
        userAccountId,
        months: body.months,
        renewalCost: body.amount,
        actorUserAccountId: request.userAccountId,
        source: 'manual_admin',
        sourceSaleId: body.source_sale_id,
        comment: body.comment,
        startDate: body.start_date,
        forceStartDate: body.override === true
      });

      return reply.send({ success: true, result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/admin/subscriptions/users/:userAccountId/deactivate', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const { userAccountId } = request.params as { userAccountId: string };

      const { error } = await supabase
        .from('user_accounts')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userAccountId);

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.get('/admin/subscriptions/user-search', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const q = ((request.query as any)?.q as string | undefined)?.trim();
      const limit = Math.min(parseInt((request.query as any)?.limit || '20', 10), 100);

      let query = supabase
        .from('user_accounts')
        .select('id, username, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4, tarif, tarif_expires, is_active, created_at')
        .eq('is_tech_admin', false)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (q && q.length > 0) {
        const term = sanitizeSearchTerm(q);
        query = query.or([
          `username.ilike.%${term}%`,
          `telegram_id.ilike.%${term}%`,
          `telegram_id_2.ilike.%${term}%`,
          `telegram_id_3.ilike.%${term}%`,
          `telegram_id_4.ilike.%${term}%`
        ].join(','));
      }

      const { data, error } = await query;
      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.get('/admin/subscriptions/phone-links', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const phone = (request.query as any)?.phone as string | undefined;
      if (!phone) {
        return reply.status(400).send({ error: 'phone query parameter is required' });
      }

      const normalizedPhone = normalizePhone(phone);

      const { data: links, error: linksError } = await supabase
        .from('crm_phone_user_links')
        .select('*')
        .eq('normalized_phone', normalizedPhone)
        .order('created_at', { ascending: false });

      if (linksError) {
        return reply.status(500).send({ error: linksError.message });
      }

      return reply.send({ normalized_phone: normalizedPhone, links: links || [] });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/admin/subscriptions/phone-links', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const body = createPhoneLinkSchema.parse(request.body);
      const normalizedPhone = normalizePhone(body.phone);

      const { data: link, error } = await supabase
        .from('crm_phone_user_links')
        .upsert({
          normalized_phone: normalizedPhone,
          user_account_id: body.user_account_id,
          linked_by: request.userAccountId,
          active: body.active,
          notes: body.notes || null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'normalized_phone,user_account_id'
        })
        .select('*')
        .single();

      if (error || !link) {
        return reply.status(500).send({ error: error?.message || 'Failed to save phone link' });
      }

      return reply.send(link);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: error.errors });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  app.post('/admin/subscriptions/run-jobs', async (request: ConsultantAuthRequest, reply) => {
    try {
      if (!(await requireTechAdmin(request, reply))) {
        return;
      }

      const stats = await processSubscriptionBillingSweep();
      return reply.send({ success: true, stats });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
