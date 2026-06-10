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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      memory_atoms: {
        Row: {
          created_at: string
          id: string
          last_reviewed: string
          reviews: number
          strength: number
          student_id: string
          subject: string
          summary: string
          topic: string
          state: string
          state_reason: string | null
          state_updated_at: string
          nucleus_text: string | null
          nucleus_vector: Json | null
          semantic_mass: number
          recency: number
          gravity: number
          privacy_flag: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          last_reviewed?: string
          reviews?: number
          strength?: number
          student_id: string
          subject: string
          summary: string
          topic: string
          state?: string
          state_reason?: string | null
          state_updated_at?: string
          nucleus_text?: string | null
          nucleus_vector?: Json | null
          semantic_mass?: number
          recency?: number
          gravity?: number
          privacy_flag?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          last_reviewed?: string
          reviews?: number
          strength?: number
          student_id?: string
          subject?: string
          summary?: string
          topic?: string
          state?: string
          state_reason?: string | null
          state_updated_at?: string
          nucleus_text?: string | null
          nucleus_vector?: Json | null
          semantic_mass?: number
          recency?: number
          gravity?: number
          privacy_flag?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "memory_atoms_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          id: string
          student_id: string
          agent: string
          status: string
          summary: string | null
          payload: Json | null
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          student_id: string
          agent: string
          status?: string
          summary?: string | null
          payload?: Json | null
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          agent?: string
          status?: string
          summary?: string | null
          payload?: Json | null
          duration_ms?: number | null
          created_at?: string
        }
        Relationships: []
      }
      safety_events: {
        Row: {
          id: string
          student_id: string | null
          thread_id: string | null
          category: string
          reason: string | null
          mode: string | null
          input_excerpt: string | null
          created_at: string
        }
        Insert: {
          id?: string
          student_id?: string | null
          thread_id?: string | null
          category: string
          reason?: string | null
          mode?: string | null
          input_excerpt?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          student_id?: string | null
          thread_id?: string | null
          category?: string
          reason?: string | null
          mode?: string | null
          input_excerpt?: string | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: "admin" | "student"
        }
        Insert: {
          id?: string
          user_id: string
          role: "admin" | "student"
        }
        Update: {
          id?: string
          user_id?: string
          role?: "admin" | "student"
        }
        Relationships: []
      }
      memory_bonds: {
        Row: {
          created_at: string
          id: string
          relation: string
          source_atom: string
          student_id: string
          target_atom: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          relation?: string
          source_atom: string
          student_id: string
          target_atom: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          relation?: string
          source_atom?: string
          student_id?: string
          target_atom?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "memory_bonds_source_atom_fkey"
            columns: ["source_atom"]
            isOneToOne: false
            referencedRelation: "memory_atoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_bonds_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_bonds_target_atom_fkey"
            columns: ["target_atom"]
            isOneToOne: false
            referencedRelation: "memory_atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent: string
          content: Json
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          agent?: string
          content: Json
          created_at?: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          agent?: string
          content?: Json
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_items: {
        Row: {
          activity: string
          created_at: string
          due_on: string | null
          id: string
          status: string
          student_id: string
          subject: string
          topic: string
          week: number
        }
        Insert: {
          activity: string
          created_at?: string
          due_on?: string | null
          id?: string
          status?: string
          student_id: string
          subject: string
          topic: string
          week: number
        }
        Update: {
          activity?: string
          created_at?: string
          due_on?: string | null
          id?: string
          status?: string
          student_id?: string
          subject?: string
          topic?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      reflections: {
        Row: {
          atoms_added: number
          bonds_added: number
          created_at: string
          id: string
          next_focus: string | null
          student_id: string
          summary: string
          thread_id: string | null
        }
        Insert: {
          atoms_added?: number
          bonds_added?: number
          created_at?: string
          id?: string
          next_focus?: string | null
          student_id: string
          summary: string
          thread_id?: string | null
        }
        Update: {
          atoms_added?: number
          bonds_added?: number
          created_at?: string
          id?: string
          next_focus?: string | null
          student_id?: string
          summary?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reflections_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reflections_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          avatar_emoji: string
          bio: string | null
          city: string | null
          created_at: string
          exam: string
          grade: number
          id: string
          language: string
          name: string
          auth_user_id: string | null
        }
        Insert: {
          avatar_emoji?: string
          bio?: string | null
          city?: string | null
          created_at?: string
          exam: string
          grade?: number
          id?: string
          language?: string
          name: string
          auth_user_id?: string | null
        }
        Update: {
          avatar_emoji?: string
          bio?: string | null
          city?: string | null
          created_at?: string
          exam?: string
          grade?: number
          id?: string
          language?: string
          name?: string
          auth_user_id?: string | null
        }
        Relationships: []
      }
      threads: {
        Row: {
          created_at: string
          id: string
          student_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          student_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          student_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      weak_topics: {
        Row: {
          detected_at: string
          evidence: string | null
          id: string
          severity: number
          student_id: string
          subject: string
          topic: string
        }
        Insert: {
          detected_at?: string
          evidence?: string | null
          id?: string
          severity?: number
          student_id: string
          subject: string
          topic: string
        }
        Update: {
          detected_at?: string
          evidence?: string | null
          id?: string
          severity?: number
          student_id?: string
          subject?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "weak_topics_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
