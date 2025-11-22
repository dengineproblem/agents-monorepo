export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      campaign_reports: {
        Row: {
          created_at: string
          id: string
          report_data: Json
          telegram_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          report_data: Json
          telegram_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          report_data?: Json
          telegram_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          chat_id: string | null
          conversation_id: string
          created_at: string
          funnel_status: string | null
          last_follow_up_date: string | null
          last_message_date: string
          updated_at: string
        }
        Insert: {
          chat_id?: string | null
          conversation_id: string
          created_at?: string
          funnel_status?: string | null
          last_follow_up_date?: string | null
          last_message_date?: string
          updated_at?: string
        }
        Update: {
          chat_id?: string | null
          conversation_id?: string
          created_at?: string
          funnel_status?: string | null
          last_follow_up_date?: string | null
          last_message_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          id: string
          role: Database["public"]["Enums"]["message_role_enum"]
          ts: string
        }
        Insert: {
          content: string
          conversation_id: string
          id?: string
          role: Database["public"]["Enums"]["message_role_enum"]
          ts?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          id?: string
          role?: Database["public"]["Enums"]["message_role_enum"]
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["conversation_id"]
          },
        ]
      }
      user_briefing_responses: {
        Row: {
          id: string
          user_id: string
          business_name: string
          business_niche: string
          instagram_url: string | null
          website_url: string | null
          target_audience: string | null
          geography: string | null
          main_services: string | null
          competitive_advantages: string | null
          price_segment: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          business_name: string
          business_niche: string
          instagram_url?: string | null
          website_url?: string | null
          target_audience?: string | null
          geography?: string | null
          main_services?: string | null
          competitive_advantages?: string | null
          price_segment?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          business_name?: string
          business_niche?: string
          instagram_url?: string | null
          website_url?: string | null
          target_audience?: string | null
          geography?: string | null
          main_services?: string | null
          competitive_advantages?: string | null
          price_segment?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_briefing_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      user_accounts: {
        Row: {
          access_token: string
          ad_account_id: string
          autopilot: boolean | null
          city_id: string | null
          created_at: string | null
          creative_generations_available: number | null
          id: string
          instagram_id: string | null
          instagram_username: string | null
          is_active: boolean | null
          page_id: string
          page_name: string | null
          password: string
          site_url: string | null
          facebook_pixel_id: string | null
          tarif: string | null
          optimization: string | null
          prompt1: string | null
          prompt2: string | null
          prompt3: string | null
          prompt4: string | null
          telegram_bot_token: string | null
          telegram_id: string | null
          tiktok_access_token: string | null
          tiktok_account_id: string | null
          tiktok_business_id: string | null
          updated_at: string | null
          username: string
          webhook_url: string | null
           current_campaign_goal?: 'whatsapp' | 'instagram_traffic' | 'site_leads' | null
           current_campaign_goal_changed_at?: string | null
          ig_seed_audience_id: string | null
        }
        Insert: {
          access_token: string
          ad_account_id: string
          autopilot?: boolean | null
          city_id?: string | null
          created_at?: string | null
          creative_generations_available?: number | null
          id?: string
          instagram_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          page_id: string
          page_name?: string | null
          password: string
          site_url?: string | null
          facebook_pixel_id?: string | null
          tarif?: string | null
          optimization?: string | null
          prompt1?: string | null
          prompt2?: string | null
          prompt3?: string | null
          prompt4?: string | null
          telegram_bot_token?: string | null
          telegram_id?: string | null
          tiktok_access_token?: string | null
          tiktok_account_id?: string | null
          tiktok_business_id?: string | null
          updated_at?: string | null
          username: string
          webhook_url?: string | null
           current_campaign_goal?: 'whatsapp' | 'instagram_traffic' | 'site_leads' | null
           current_campaign_goal_changed_at?: string | null
          ig_seed_audience_id?: string | null
        }
        Update: {
          access_token?: string
          ad_account_id?: string
          autopilot?: boolean | null
          city_id?: string | null
          created_at?: string | null
          creative_generations_available?: number | null
          id?: string
          instagram_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          page_id?: string
          page_name?: string | null
          password?: string
          site_url?: string | null
          facebook_pixel_id?: string | null
          tarif?: string | null
          optimization?: string | null
          prompt1?: string | null
          prompt2?: string | null
          prompt3?: string | null
          prompt4?: string | null
          telegram_bot_token?: string | null
          telegram_id?: string | null
          tiktok_access_token?: string | null
          tiktok_account_id?: string | null
          tiktok_business_id?: string | null
          updated_at?: string | null
          username?: string
          webhook_url?: string | null
           current_campaign_goal?: 'whatsapp' | 'instagram_traffic' | 'site_leads' | null
           current_campaign_goal_changed_at?: string | null
          ig_seed_audience_id?: string | null
        }
        Relationships: []
      }
      user_directions: {
        Row: {
          id: number
          user_id: string
          main_direction: string
          sub_direction: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          main_direction: string
          sub_direction?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          main_direction?: string
          sub_direction?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_directions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      user_creatives: {
        Row: {
          id: string
          user_id: string
          title: string
          fb_video_id: string | null
          fb_creative_id_whatsapp: string | null
          fb_creative_id_instagram_traffic: string | null
          fb_creative_id_site_leads: string | null
          status: string
          is_active: boolean
          error_text: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          fb_video_id?: string | null
          fb_creative_id_whatsapp?: string | null
          fb_creative_id_instagram_traffic?: string | null
          fb_creative_id_site_leads?: string | null
          status?: string
          is_active?: boolean
          error_text?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          fb_video_id?: string | null
          fb_creative_id_whatsapp?: string | null
          fb_creative_id_instagram_traffic?: string | null
          fb_creative_id_site_leads?: string | null
          status?: string
          is_active?: boolean
          error_text?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_creatives_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: false,
            referencedRelation: "user_accounts",
            referencedColumns: ["id"]
          },
        ]
      }
      planned_metrics: {
        Row: {
          id: number
          user_direction_id: number
          metric_type: 'leads' | 'spend'
          planned_daily_value: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_direction_id: number
          metric_type: 'leads' | 'spend'
          planned_daily_value?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_direction_id?: number
          metric_type?: 'leads' | 'spend'
          planned_daily_value?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_metrics_user_direction_id_fkey"
            columns: ["user_direction_id"]
            isOneToOne: false
            referencedRelation: "user_directions"
            referencedColumns: ["id"]
          }
        ]
      }
      targetolog_actions: {
        Row: {
          id: number
          user_id: string
          username: string | null
          action_text: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: number
          user_id: string
          username?: string | null
          action_text: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          username?: string | null
          action_text?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "targetolog_actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      video_uploads: {
        Row: {
          file_path: string
          file_size: number
          id: string
          original_name: string
          signed_url: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          file_path: string
          file_size: number
          id?: string
          original_name: string
          signed_url: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          file_path?: string
          file_size?: number
          id?: string
          original_name?: string
          signed_url?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      registration_temp: {
        Row: {
          id: string;
          registration_id: string;
          telegram_id: string | null;
          username: string | null;
          password_hash: string | null;
          phone: string | null;
          fb_access_token: string | null;
          ad_accounts: Json | null;
          selected_ad_account_id: string | null;
          page_id: string | null;
          instagram_id: string | null;
          registration_stage: string | null;
          prompt1: string | null;
          prompt2: string | null;
          prompt3: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          registration_id: string;
          telegram_id?: string | null;
          username?: string | null;
          password_hash?: string | null;
          phone?: string | null;
          fb_access_token?: string | null;
          ad_accounts?: Json | null;
          selected_ad_account_id?: string | null;
          page_id?: string | null;
          instagram_id?: string | null;
          registration_stage?: string | null;
          prompt1?: string | null;
          prompt2?: string | null;
          prompt3?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          registration_id?: string;
          telegram_id?: string | null;
          username?: string | null;
          password_hash?: string | null;
          phone?: string | null;
          fb_access_token?: string | null;
          ad_accounts?: Json | null;
          selected_ad_account_id?: string | null;
          page_id?: string | null;
          instagram_id?: string | null;
          registration_stage?: string | null;
          prompt1?: string | null;
          prompt2?: string | null;
          prompt3?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      },
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      message_role_enum: "bot" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      message_role_enum: ["bot", "user"],
    },
  },
} as const
