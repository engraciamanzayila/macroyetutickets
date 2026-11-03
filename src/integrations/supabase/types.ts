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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      event_contracts: {
        Row: {
          admin_signed_at: string | null
          admin_signed_by: string | null
          admin_signed_name: string | null
          commission_pct: number
          created_at: string
          data: Json
          event_id: string
          exclusive: boolean
          id: string
          promoter_id: string
          signed_at: string
          signed_name: string
        }
        Insert: {
          admin_signed_at?: string | null
          admin_signed_by?: string | null
          admin_signed_name?: string | null
          commission_pct: number
          created_at?: string
          data?: Json
          event_id: string
          exclusive?: boolean
          id?: string
          promoter_id: string
          signed_at?: string
          signed_name: string
        }
        Update: {
          admin_signed_at?: string | null
          admin_signed_by?: string | null
          admin_signed_name?: string | null
          commission_pct?: number
          created_at?: string
          data?: Json
          event_id?: string
          exclusive?: boolean
          id?: string
          promoter_id?: string
          signed_at?: string
          signed_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_contracts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          approval_note: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          category: string | null
          city: string | null
          commission_pct: number
          cover_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          event_date: string | null
          event_time: string | null
          id: string
          name: string
          owner_id: string | null
          payment_info: string | null
          published: boolean
          sheet_id: string | null
          slug: string | null
          ticket_email_cc: string | null
          ticket_email_extra_cc: string[]
          venue: string | null
        }
        Insert: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          city?: string | null
          commission_pct?: number
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          name: string
          owner_id?: string | null
          payment_info?: string | null
          published?: boolean
          sheet_id?: string | null
          slug?: string | null
          ticket_email_cc?: string | null
          ticket_email_extra_cc?: string[]
          venue?: string | null
        }
        Update: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          city?: string | null
          commission_pct?: number
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          payment_info?: string | null
          published?: boolean
          sheet_id?: string | null
          slug?: string | null
          ticket_email_cc?: string | null
          ticket_email_extra_cc?: string[]
          venue?: string | null
        }
        Relationships: []
      }
      group_shares: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          created_by: string | null
          event_id: string
          expires_at: string | null
          group_id: string
          id: string
          note: string | null
          partner_kind: string
          partner_name: string
          token: string
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          expires_at?: string | null
          group_id: string
          id?: string
          note?: string | null
          partner_kind?: string
          partner_name: string
          token?: string
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          note?: string | null
          partner_kind?: string
          partner_name?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_shares_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ticket_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          group_id: string
          id: string
          order_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          group_id: string
          id?: string
          order_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          group_id?: string
          id?: string
          order_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ticket_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token: string
          buyer_email: string | null
          buyer_name: string
          buyer_phone: string
          buyer_user_id: string | null
          created_at: string
          delivery_channel: string
          event_id: string
          id: string
          paid_at: string | null
          payment_method: string
          payment_reference: string | null
          status: string
          total: number
        }
        Insert: {
          access_token?: string
          buyer_email?: string | null
          buyer_name: string
          buyer_phone: string
          buyer_user_id?: string | null
          created_at?: string
          delivery_channel?: string
          event_id: string
          id?: string
          paid_at?: string | null
          payment_method: string
          payment_reference?: string | null
          status?: string
          total?: number
        }
        Update: {
          access_token?: string
          buyer_email?: string | null
          buyer_name?: string
          buyer_phone?: string
          buyer_user_id?: string | null
          created_at?: string
          delivery_channel?: string
          event_id?: string
          id?: string
          paid_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          file_name: string
          id: string
          page_count: number
          source_printed_at: string
          storage_path: string | null
          ticket_count: number
          ticket_ids: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          file_name: string
          id?: string
          page_count?: number
          source_printed_at: string
          storage_path?: string | null
          ticket_count?: number
          ticket_ids?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          file_name?: string
          id?: string
          page_count?: number
          source_printed_at?: string
          storage_path?: string | null
          ticket_count?: number
          ticket_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          wants_promoter: boolean
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          wants_promoter?: boolean
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          wants_promoter?: boolean
        }
        Relationships: []
      }
      ticket_groups: {
        Row: {
          art_height: number | null
          art_path: string | null
          art_width: number | null
          created_at: string
          event_id: string
          for_sale: boolean
          height_cm: number | null
          id: string
          layout: Json | null
          name: string
          price: number
          quantity: number
          recipient: string | null
          source_filename: string | null
          ticket_type: string
          width_cm: number | null
        }
        Insert: {
          art_height?: number | null
          art_path?: string | null
          art_width?: number | null
          created_at?: string
          event_id: string
          for_sale?: boolean
          height_cm?: number | null
          id?: string
          layout?: Json | null
          name: string
          price?: number
          quantity?: number
          recipient?: string | null
          source_filename?: string | null
          ticket_type?: string
          width_cm?: number | null
        }
        Update: {
          art_height?: number | null
          art_path?: string | null
          art_width?: number | null
          created_at?: string
          event_id?: string
          for_sale?: boolean
          height_cm?: number | null
          id?: string
          layout?: Json | null
          name?: string
          price?: number
          quantity?: number
          recipient?: string | null
          source_filename?: string | null
          ticket_type?: string
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          code: string
          created_at: string
          email_delivery_cc: string[]
          email_delivery_error: string | null
          email_delivery_status: string
          email_delivery_to: string | null
          email_delivery_updated_at: string | null
          email_sent_at: string | null
          event_id: string
          group_id: string
          holder_contact: string | null
          holder_name: string | null
          id: string
          order_id: string | null
          printed_at: string | null
          sent_at: string | null
          sent_via: string | null
          seq: number
          share_id: string | null
          share_token: string
          status: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          email_delivery_cc?: string[]
          email_delivery_error?: string | null
          email_delivery_status?: string
          email_delivery_to?: string | null
          email_delivery_updated_at?: string | null
          email_sent_at?: string | null
          event_id: string
          group_id: string
          holder_contact?: string | null
          holder_name?: string | null
          id?: string
          order_id?: string | null
          printed_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          seq: number
          share_id?: string | null
          share_token?: string
          status?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          email_delivery_cc?: string[]
          email_delivery_error?: string | null
          email_delivery_status?: string
          email_delivery_to?: string | null
          email_delivery_updated_at?: string | null
          email_sent_at?: string | null
          event_id?: string
          group_id?: string
          holder_contact?: string | null
          holder_name?: string | null
          id?: string
          order_id?: string | null
          printed_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          seq?: number
          share_id?: string | null
          share_token?: string
          status?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ticket_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "group_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      zoho_mail_config: {
        Row: {
          ciphertext: string
          created_at: string
          data_center: string
          id: number
          sender_email: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ciphertext: string
          created_at?: string
          data_center: string
          id: number
          sender_email: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ciphertext?: string
          created_at?: string
          data_center?: string
          id?: number
          sender_email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_event: {
        Args: { _event: string; _uid: string }
        Returns: boolean
      }
      can_view_event: {
        Args: { _event: string; _uid: string }
        Returns: boolean
      }
      check_in: {
        Args: { p_at?: string; p_code: string; p_event: string }
        Returns: Json
      }
      claim_ticket_email_delivery: {
        Args: { p_event: string; p_ticket_ids: string[] }
        Returns: boolean
      }
      confirm_order: { Args: { p_order: string }; Returns: undefined }
      create_order: {
        Args: {
          p_delivery: string
          p_email: string
          p_event: string
          p_items: Json
          p_method: string
          p_name: string
          p_phone: string
        }
        Returns: Json
      }
      get_order: { Args: { p_token: string }; Returns: Json }
      group_available: { Args: { _group: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      review_event: {
        Args: { p_approve: boolean; p_event: string; p_note: string }
        Returns: undefined
      }
      sign_contract: {
        Args: {
          p_data: Json
          p_event: string
          p_exclusive: boolean
          p_name: string
        }
        Returns: undefined
      }
      submit_payment_reference: {
        Args: { p_ref: string; p_token: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "promoter"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "promoter"],
    },
  },
} as const
