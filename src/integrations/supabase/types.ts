export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          address: string | null
          avatar: string | null
          city: string | null
          country: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string
          email_confirmed_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          nationality: string | null
          phone_number: string | null
          postcode: string | null
          province: string | null
          registered_at: string | null
          role: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          avatar?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email: string
          email_confirmed_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          nationality?: string | null
          phone_number?: string | null
          postcode?: string | null
          province?: string | null
          registered_at?: string | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          avatar?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string
          email_confirmed_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          nationality?: string | null
          phone_number?: string | null
          postcode?: string | null
          province?: string | null
          registered_at?: string | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      brand_leads: {
        Row: {
          company_name: string | null
          created_at: string
          id: number
          n_of_stores: string | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: number
          n_of_stores?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: number
          n_of_stores?: string | null
          website?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          activation_fee: number | null
          aion_premium_fee: number | null
          auth_background_image: string | null
          chubb_policy_prefix: string | null
          created_at: string
          damage_image: string | null
          description: string | null
          email: string | null
          enable_chubb_reporting: boolean | null
          faq_en: Json | null
          faq_image: string | null
          faq_it: Json | null
          feedback_image: string | null
          hq_address: string | null
          hq_city: string | null
          hq_country: string | null
          hq_postcode: string | null
          id: number
          insurance_premium: number | null
          logo_big: string | null
          logo_small: string | null
          name: string | null
          slug: string | null
          status: string | null
          theft_image: string | null
          theme_settings: Json | null
          top_banner_image: string | null
          website: string | null
        }
        Insert: {
          activation_fee?: number | null
          aion_premium_fee?: number | null
          auth_background_image?: string | null
          chubb_policy_prefix?: string | null
          created_at?: string
          damage_image?: string | null
          description?: string | null
          email?: string | null
          enable_chubb_reporting?: boolean | null
          faq_en?: Json | null
          faq_image?: string | null
          faq_it?: Json | null
          feedback_image?: string | null
          hq_address?: string | null
          hq_city?: string | null
          hq_country?: string | null
          hq_postcode?: string | null
          id?: number
          insurance_premium?: number | null
          logo_big?: string | null
          logo_small?: string | null
          name?: string | null
          slug?: string | null
          status?: string | null
          theft_image?: string | null
          theme_settings?: Json | null
          top_banner_image?: string | null
          website?: string | null
        }
        Update: {
          activation_fee?: number | null
          aion_premium_fee?: number | null
          auth_background_image?: string | null
          chubb_policy_prefix?: string | null
          created_at?: string
          damage_image?: string | null
          description?: string | null
          email?: string | null
          enable_chubb_reporting?: boolean | null
          faq_en?: Json | null
          faq_image?: string | null
          faq_it?: Json | null
          feedback_image?: string | null
          hq_address?: string | null
          hq_city?: string | null
          hq_country?: string | null
          hq_postcode?: string | null
          id?: number
          insurance_premium?: number | null
          logo_big?: string | null
          logo_small?: string | null
          name?: string | null
          slug?: string | null
          status?: string | null
          theft_image?: string | null
          theme_settings?: Json | null
          top_banner_image?: string | null
          website?: string | null
        }
        Relationships: []
      }
      catalogues: {
        Row: {
          brand_id: number | null
          brand_item_id: string | null
          category: string | null
          collection: string | null
          composition: string | null
          created_at: string
          description: string | null
          id: number
          name: string | null
          picture: string | null
          sku: string | null
          slug: string | null
        }
        Insert: {
          brand_id?: number | null
          brand_item_id?: string | null
          category?: string | null
          collection?: string | null
          composition?: string | null
          created_at?: string
          description?: string | null
          id?: number
          name?: string | null
          picture?: string | null
          sku?: string | null
          slug?: string | null
        }
        Update: {
          brand_id?: number | null
          brand_item_id?: string | null
          category?: string | null
          collection?: string | null
          composition?: string | null
          created_at?: string
          description?: string | null
          id?: number
          name?: string | null
          picture?: string | null
          sku?: string | null
          slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalogues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          cancelled_at: string | null
          closed_at: string | null
          created_at: string
          description: string | null
          id: number
          incident_city: string | null
          incident_country: string | null
          incident_date: string | null
          media: string[] | null
          policy_id: number
          status: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: number
          incident_city?: string | null
          incident_country?: string | null
          incident_date?: string | null
          media?: string[] | null
          policy_id: number
          status?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          id?: number
          incident_city?: string | null
          incident_country?: string | null
          incident_date?: string | null
          media?: string[] | null
          policy_id?: number
          status?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      external_requests: {
        Row: {
          brand_id: number | null
          created_at: string
          id: number
          request: Json | null
          return_id: string | null
          row_id: string | null
          sale_id: string | null
          source: string | null
        }
        Insert: {
          brand_id?: number | null
          created_at?: string
          id?: number
          request?: Json | null
          return_id?: string | null
          row_id?: string | null
          sale_id?: string | null
          source?: string | null
        }
        Update: {
          brand_id?: number | null
          created_at?: string
          id?: number
          request?: Json | null
          return_id?: string | null
          row_id?: string | null
          sale_id?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          brand_id: number | null
          comment: string | null
          created_at: string
          id: number
          peace_of_mind_rate: number | null
          recommendation_rate: number | null
          satisfaction_rate: number | null
          user_id: string | null
        }
        Insert: {
          brand_id?: number | null
          comment?: string | null
          created_at?: string
          id?: number
          peace_of_mind_rate?: number | null
          recommendation_rate?: number | null
          satisfaction_rate?: number | null
          user_id?: string | null
        }
        Update: {
          brand_id?: number | null
          comment?: string | null
          created_at?: string
          id?: number
          peace_of_mind_rate?: number | null
          recommendation_rate?: number | null
          satisfaction_rate?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_costs: {
        Row: {
          brand_id: number | null
          category: string | null
          chubb_category: string | null
          cost_pct: number | null
          created_at: string
          id: number
        }
        Insert: {
          brand_id?: number | null
          category?: string | null
          chubb_category?: string | null
          cost_pct?: number | null
          created_at?: string
          id?: number
        }
        Update: {
          brand_id?: number | null
          category?: string | null
          chubb_category?: string | null
          cost_pct?: number | null
          created_at?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_costs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          brand_id: number | null
          brand_row_id: string | null
          brand_sale_id: string
          brand_sub_order_row_code: string | null
          cancelled_at: string | null
          cogs: number | null
          created_at: string
          customer_id: string | null
          expiration_date: string | null
          external_request_id: number | null
          former_customer_ids: string[] | null
          id: number
          internal_notes: string | null
          item_id: number
          notes: string | null
          original_brand_row_id: string | null
          original_brand_sub_order_row_code: string | null
          purchase_receipt: string | null
          quantity: number | null
          recommended_retail_price: number | null
          return_id: number | null
          selling_price: number | null
          shop_id: number | null
          source: string | null
          start_date: string
          status: string | null
          transferred_at: string | null
          updated_at: string | null
        }
        Insert: {
          brand_id?: number | null
          brand_row_id?: string | null
          brand_sale_id: string
          brand_sub_order_row_code?: string | null
          cancelled_at?: string | null
          cogs?: number | null
          created_at?: string
          customer_id?: string | null
          expiration_date?: string | null
          external_request_id?: number | null
          former_customer_ids?: string[] | null
          id?: number
          internal_notes?: string | null
          item_id: number
          notes?: string | null
          original_brand_row_id?: string | null
          original_brand_sub_order_row_code?: string | null
          purchase_receipt?: string | null
          quantity?: number | null
          recommended_retail_price?: number | null
          return_id?: number | null
          selling_price?: number | null
          shop_id?: number | null
          source?: string | null
          start_date: string
          status?: string | null
          transferred_at?: string | null
          updated_at?: string | null
        }
        Update: {
          brand_id?: number | null
          brand_row_id?: string | null
          brand_sale_id?: string
          brand_sub_order_row_code?: string | null
          cancelled_at?: string | null
          cogs?: number | null
          created_at?: string
          customer_id?: string | null
          expiration_date?: string | null
          external_request_id?: number | null
          former_customer_ids?: string[] | null
          id?: number
          internal_notes?: string | null
          item_id?: number
          notes?: string | null
          original_brand_row_id?: string | null
          original_brand_sub_order_row_code?: string | null
          purchase_receipt?: string | null
          quantity?: number | null
          recommended_retail_price?: number | null
          return_id?: number | null
          selling_price?: number | null
          shop_id?: number | null
          source?: string | null
          start_date?: string
          status?: string | null
          transferred_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insured_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insured_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "catalogues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insured_items_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_external_request_id_fkey"
            columns: ["external_request_id"]
            isOneToOne: false
            referencedRelation: "external_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar: string | null
          brand_id: number
          business_address: string | null
          city: string | null
          country: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string
          email_confirmed_at: string | null
          entity_name: string | null
          first_name: string | null
          id: string
          is_master: boolean | null
          is_visible: boolean | null
          last_name: string | null
          nationality: string | null
          phone_number: string | null
          position: string | null
          postcode: string | null
          province: string | null
          registered_at: string | null
          role: string | null
          shop_id: number | null
          status: string | null
          updated_at: string | null
          user_id: string | null
          vat: string | null
        }
        Insert: {
          address?: string | null
          avatar?: string | null
          brand_id: number
          business_address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email: string
          email_confirmed_at?: string | null
          entity_name?: string | null
          first_name?: string | null
          id?: string
          is_master?: boolean | null
          is_visible?: boolean | null
          last_name?: string | null
          nationality?: string | null
          phone_number?: string | null
          position?: string | null
          postcode?: string | null
          province?: string | null
          registered_at?: string | null
          role?: string | null
          shop_id?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          vat?: string | null
        }
        Update: {
          address?: string | null
          avatar?: string | null
          brand_id?: number
          business_address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string
          email_confirmed_at?: string | null
          entity_name?: string | null
          first_name?: string | null
          id?: string
          is_master?: boolean | null
          is_visible?: boolean | null
          last_name?: string | null
          nationality?: string | null
          phone_number?: string | null
          position?: string | null
          postcode?: string | null
          province?: string | null
          registered_at?: string | null
          role?: string | null
          shop_id?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          vat?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          brand_id: number | null
          created_at: string
          created_by: string | null
          direction: string | null
          end_date: string | null
          id: number
          name: string
          source: string | null
          start_date: string | null
          type: string | null
          uploaded_to_chubb: boolean | null
          uploaded_to_chubb_at: string | null
          uploaded_to_chubb_by: string | null
          url: string
        }
        Insert: {
          brand_id?: number | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          end_date?: string | null
          id?: number
          name: string
          source?: string | null
          start_date?: string | null
          type?: string | null
          uploaded_to_chubb?: boolean | null
          uploaded_to_chubb_at?: string | null
          uploaded_to_chubb_by?: string | null
          url: string
        }
        Update: {
          brand_id?: number | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          end_date?: string | null
          id?: number
          name?: string
          source?: string | null
          start_date?: string | null
          type?: string | null
          uploaded_to_chubb?: boolean | null
          uploaded_to_chubb_at?: string | null
          uploaded_to_chubb_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_uploaded_to_chubb_by_fkey"
            columns: ["uploaded_to_chubb_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          created_at: string
          id: number
          old_policy_id: number | null
          return_id: string | null
          return_shop_id: number | null
          returned_at: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          old_policy_id?: number | null
          return_id?: string | null
          return_shop_id?: number | null
          returned_at?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          old_policy_id?: number | null
          return_id?: string | null
          return_shop_id?: number | null
          returned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_old_policy_id_fkey"
            columns: ["old_policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_return_shop_id_fkey"
            columns: ["return_shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          brand_id: number
          brand_shop_id: string | null
          city: string | null
          contact: string | null
          country: string | null
          created_at: string
          id: number
          name: string | null
          status: string | null
        }
        Insert: {
          address?: string | null
          brand_id: number
          brand_shop_id?: string | null
          city?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          id?: number
          name?: string | null
          status?: string | null
        }
        Update: {
          address?: string | null
          brand_id?: number
          brand_shop_id?: string | null
          city?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          id?: number
          name?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          brand_id: number | null
          created_at: string
          customer_id: string | null
          id: number
          message: string | null
        }
        Insert: {
          brand_id?: number | null
          created_at?: string
          customer_id?: string | null
          id?: number
          message?: string | null
        }
        Update: {
          brand_id?: number | null
          created_at?: string
          customer_id?: string | null
          id?: number
          message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_brand_id: { Args: never; Returns: number }
      get_my_profile_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
      mark_policies_expired: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
