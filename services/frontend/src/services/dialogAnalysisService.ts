import { DialogAnalysis, DialogStats, DialogFilters } from '@/types/dialogAnalysis';
import { supabase } from '@/integrations/supabase/client';

export const dialogAnalysisService = {
  /**
   * Get analysis results with filters
   */
  async getAnalysis(userAccountId: string, filters?: DialogFilters): Promise<{ results: DialogAnalysis[]; count: number }> {
    let query = supabase
      .from('dialog_analysis')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('score', { ascending: false })
      .order('last_message', { ascending: false });
    
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
      console.error('Supabase error:', error);
      throw new Error('Failed to fetch dialog analysis');
    }
    
    return {
      results: (data || []) as DialogAnalysis[],
      count: count || data?.length || 0,
    };
  },

  /**
   * Get statistics
   */
  async getStats(userAccountId: string): Promise<DialogStats> {
    const { data, error } = await supabase
      .from('dialog_analysis')
      .select('interest_level, score, incoming_count, funnel_stage, qualification_complete')
      .eq('user_account_id', userAccountId);
    
    if (error) {
      console.error('Supabase error:', error);
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
   */
  async exportToCsv(userAccountId: string, filters?: DialogFilters): Promise<Blob> {
    let query = supabase
      .from('dialog_analysis')
      .select('contact_phone, contact_name, interest_level, score, business_type, funnel_stage, instagram_url, ad_budget, qualification_complete, is_owner, has_sales_dept, uses_ads_now, objection, next_message, incoming_count, outgoing_count, last_message')
      .eq('user_account_id', userAccountId)
      .order('score', { ascending: false });
    
    if (filters?.interestLevel) {
      query = query.eq('interest_level', filters.interestLevel);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
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
      console.error('Supabase error:', error);
      throw new Error('Failed to delete analysis');
    }
  },
};

