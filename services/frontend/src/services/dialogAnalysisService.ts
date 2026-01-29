import { DialogAnalysis, DialogStats, DialogFilters } from '@/types/dialogAnalysis';
import { supabase } from '@/integrations/supabase/client';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

export const dialogAnalysisService = {
  /**
   * Get analysis results with filters
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getAnalysis(userAccountId: string, filters?: DialogFilters, accountId?: string): Promise<{ results: DialogAnalysis[]; count: number }> {
    let query = supabase
      .from('dialog_analysis')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('score', { ascending: false })
      .order('last_message', { ascending: false });

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (shouldFilterByAccountId(accountId)) {
      query = query.eq('account_id', accountId);
    }

    if (filters?.interestLevel) {
      query = query.eq('interest_level', filters.interestLevel);
    }

    if (filters?.funnelStage) {
      query = query.eq('funnel_stage', filters.funnelStage);
    }

    if (filters?.minScore !== undefined) {
      query = query.gte('score', filters.minScore);
    }

    if (filters?.qualificationComplete !== undefined) {
      query = query.eq('qualification_complete', filters.qualificationComplete);
    }

    const { data, error, count } = await query;

    if (error) {

      throw new Error('Failed to fetch dialog analysis');
    }

    return {
      results: (data || []) as DialogAnalysis[],
      count: count || data?.length || 0,
    };
  },

  /**
   * Get statistics
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getStats(userAccountId: string, accountId?: string): Promise<DialogStats> {
    let query = supabase
      .from('dialog_analysis')
      .select('interest_level, score, incoming_count, funnel_stage, qualification_complete')
      .eq('user_account_id', userAccountId);

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (shouldFilterByAccountId(accountId)) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    
    if (error) {

      throw new Error('Failed to fetch dialog stats');
    }
    
    if (!data) {
      return {
        total: 0,
        hot: 0,
        warm: 0,
        cold: 0,
        avgScore: 0,
        totalMessages: 0,
        new_lead: 0,
        not_qualified: 0,
        qualified: 0,
        consultation_booked: 0,
        consultation_completed: 0,
        deal_closed: 0,
        deal_lost: 0,
        qualified_count: 0,
      };
    }
    
    // Calculate statistics
    const stats: DialogStats = {
      total: data.length,
      hot: data.filter(d => d.interest_level === 'hot').length,
      warm: data.filter(d => d.interest_level === 'warm').length,
      cold: data.filter(d => d.interest_level === 'cold').length,
      avgScore: data.length 
        ? Math.round(data.reduce((sum, d) => sum + (d.score || 0), 0) / data.length)
        : 0,
      totalMessages: data.reduce((sum, d) => sum + (d.incoming_count || 0), 0),
      // Funnel stages
      new_lead: data.filter(d => d.funnel_stage === 'new_lead').length,
      not_qualified: data.filter(d => d.funnel_stage === 'not_qualified').length,
      qualified: data.filter(d => d.funnel_stage === 'qualified').length,
      consultation_booked: data.filter(d => d.funnel_stage === 'consultation_booked').length,
      consultation_completed: data.filter(d => d.funnel_stage === 'consultation_completed').length,
      deal_closed: data.filter(d => d.funnel_stage === 'deal_closed').length,
      deal_lost: data.filter(d => d.funnel_stage === 'deal_lost').length,
      // Qualification
      qualified_count: data.filter(d => d.qualification_complete === true).length,
    };
    
    return stats;
  },

  /**
   * Export to CSV
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async exportToCsv(userAccountId: string, filters?: DialogFilters, accountId?: string): Promise<Blob> {
    let query = supabase
      .from('dialog_analysis')
      .select('contact_phone, contact_name, interest_level, score, business_type, funnel_stage, instagram_url, ad_budget, qualification_complete, is_owner, has_sales_dept, uses_ads_now, objection, next_message, incoming_count, outgoing_count, last_message')
      .eq('user_account_id', userAccountId)
      .order('score', { ascending: false });

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (shouldFilterByAccountId(accountId)) {
      query = query.eq('account_id', accountId);
    }

    if (filters?.interestLevel) {
      query = query.eq('interest_level', filters.interestLevel);
    }
    
    const { data, error } = await query;
    
    if (error) {

      throw new Error('Failed to export CSV');
    }
    
    if (!data || data.length === 0) {
      throw new Error('No results to export');
    }
    
    // Generate CSV
    const headers = [
      'contact_phone',
      'contact_name',
      'interest_level',
      'score',
      'business_type',
      'funnel_stage',
      'instagram_url',
      'ad_budget',
      'qualification_complete',
      'is_owner',
      'has_sales_dept',
      'uses_ads_now',
      'objection',
      'next_message',
      'incoming_count',
      'outgoing_count',
      'last_message',
    ];
    
    const csvRows = [
      headers.join(','),
      ...data.map(row => {
        return headers.map(header => {
          const value = (row as any)[header];
          if (value === null || value === undefined) return '';
          
          // Escape quotes and wrap in quotes if contains comma or newline
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',');
      }),
    ];
    
    const csv = csvRows.join('\n');
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  },

  /**
   * Delete analysis result
   */
  async deleteAnalysis(id: string, userAccountId: string): Promise<void> {
    const { error } = await supabase
      .from('dialog_analysis')
      .delete()
      .eq('id', id)
      .eq('user_account_id', userAccountId);
    
    if (error) {

      throw new Error('Failed to delete analysis');
    }
  },

  /**
   * Create a new lead manually
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async createLead(data: {
    phone: string;
    contactName?: string;
    businessType?: string;
    isMedical?: boolean;
    funnelStage: string;
    userAccountId: string;
    instanceName: string;
    notes?: string;
    accountId?: string;
  }): Promise<DialogAnalysis> {
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .insert({
        contact_phone: data.phone,
        contact_name: data.contactName || null,
        business_type: data.businessType || null,
        is_medical: data.isMedical || false,
        funnel_stage: data.funnelStage,
        user_account_id: data.userAccountId,
        account_id: data.accountId || null,
        instance_name: data.instanceName,
        interest_level: 'cold',
        score: 5,
        incoming_count: 0,
        outgoing_count: 0,
        next_message: '',
        notes: data.notes || null,
        analyzed_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) {

      throw new Error('Failed to create lead');
    }
    
    return lead as DialogAnalysis;
  },

  /**
   * Update a lead
   */
  async updateLead(
    id: string,
    userAccountId: string,
    updates: Partial<{
      contactName: string;
      businessType: string;
      isMedical: boolean;
      isOwner: boolean;
      hasSalesDept: boolean;
      usesAdsNow: boolean;
      adBudget: string;
      sentInstagram: boolean;
      instagramUrl: string;
      hasBooking: boolean;
      funnelStage: string;
      interestLevel: string;
      objection: string;
      nextMessage: string;
      notes: string;
      score: number;
    }>
  ): Promise<DialogAnalysis> {
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.contactName !== undefined) updateData.contact_name = updates.contactName;
    if (updates.businessType !== undefined) updateData.business_type = updates.businessType;
    if (updates.isMedical !== undefined) updateData.is_medical = updates.isMedical;
    if (updates.isOwner !== undefined) updateData.is_owner = updates.isOwner;
    if (updates.hasSalesDept !== undefined) updateData.has_sales_dept = updates.hasSalesDept;
    if (updates.usesAdsNow !== undefined) updateData.uses_ads_now = updates.usesAdsNow;
    if (updates.adBudget !== undefined) updateData.ad_budget = updates.adBudget;
    if (updates.sentInstagram !== undefined) updateData.sent_instagram = updates.sentInstagram;
    if (updates.instagramUrl !== undefined) updateData.instagram_url = updates.instagramUrl;
    if (updates.hasBooking !== undefined) updateData.has_booking = updates.hasBooking;
    if (updates.funnelStage !== undefined) updateData.funnel_stage = updates.funnelStage;
    if (updates.interestLevel !== undefined) updateData.interest_level = updates.interestLevel;
    if (updates.objection !== undefined) updateData.objection = updates.objection;
    if (updates.nextMessage !== undefined) updateData.next_message = updates.nextMessage;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.score !== undefined) updateData.score = updates.score;

    const { data, error } = await supabase
      .from('dialog_analysis')
      .update(updateData)
      .eq('id', id)
      .eq('user_account_id', userAccountId)
      .select()
      .single();
    
    if (error) {

      throw new Error('Failed to update lead');
    }
    
    if (!data) {
      throw new Error('Lead not found');
    }
    
    return data as DialogAnalysis;
  },

  /**
   * Get WhatsApp instances for user
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getInstances(userAccountId: string, accountId?: string): Promise<Array<{ id: string; instance_name: string }>> {
    let query = supabase
      .from('whatsapp_instances')
      .select('id, instance_name')
      .eq('user_account_id', userAccountId)
      .order('instance_name');

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (shouldFilterByAccountId(accountId)) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    
    if (error) {

      throw new Error('Failed to fetch instances');
    }
    
    return data || [];
  },
};

