/**
 * Aderyth PostgREST schema types.
 *
 * Hand-maintained, NOT produced by `supabase gen types`. It is checked against the SQL
 * files in both directions by `__tests__/repo/databaseTypesDrift.test.ts`.
 *
 * Provenance: one `// @source` comment above every table, every RPC and every column that
 * was added after its table was created.
 *   live             exists in `supabase/live_schema.sql`, the owner's dump of the canonical project
 *   migration:<NNN>  created by `supabase/migrations/<NNN>_*.sql`; WRITTEN, NOT APPLIED until the
 *                    owner applies it (`supabase/migrations/README.md`). The client reads such
 *                    objects fail-open (PGRST205 / 42P01) until then.
 *
 * After the owner applies a migration and refreshes `live_schema.sql`, the drift test names
 * every tag that must change from `migration:<NNN>` to `live`.
 *
 * One live table is left out on purpose: see the note above `deep_work_sessions`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: unknown }
  | unknown[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      // @source live
      ai_calls: {
        Row: {
          id: string;
          user_id: string;
          called_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          called_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          called_at?: string;
        };
        Relationships: [];
      };
      // @source live
      ai_conversation_actions: {
        Row: {
          id: string;
          conversation_id: string;
          assistant_message_id: string | null;
          user_id: string;
          action_type: string;
          payload: Json;
          status: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          assistant_message_id?: string | null;
          user_id: string;
          action_type: string;
          payload: Json;
          status?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          assistant_message_id?: string | null;
          user_id?: string;
          action_type?: string;
          payload?: Json;
          status?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      ai_conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          project_id: string | null;
          created_at: string;
          updated_at: string;
          last_message_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          project_id?: string | null;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          project_id?: string | null;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      ai_messages: {
        Row: {
          id: string;
          conversation_id: string;
          user_id: string;
          role: string;
          content: string;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_id: string;
          role: string;
          content: string;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      ai_requests: {
        Row: {
          user_id: string;
          request_id: string;
          mode: string;
          input_fingerprint: string;
          status: string;
          response: Json | null;
          error: string | null;
          created_at: string;
          updated_at: string;
          lease_expires_at: string;
        };
        Insert: {
          user_id: string;
          request_id: string;
          mode: string;
          input_fingerprint: string;
          status?: string;
          response?: Json | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          lease_expires_at?: string;
        };
        Update: {
          user_id?: string;
          request_id?: string;
          mode?: string;
          input_fingerprint?: string;
          status?: string;
          response?: Json | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          lease_expires_at?: string;
        };
        Relationships: [];
      };
      // @source live
      bad_habits: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          quit_date: string;
          cost_per_day: number;
          time_wasted_per_day: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          quit_date?: string;
          cost_per_day?: number;
          time_wasted_per_day?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          quit_date?: string;
          cost_per_day?: number;
          time_wasted_per_day?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      calendars: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color_hex: string;
          type: string;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color_hex?: string;
          type?: string;
          is_default?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color_hex?: string;
          type?: string;
          is_default?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      challenges: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          duration_days: number;
          icon: string | null;
          color: string | null;
          difficulty_level: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          duration_days?: number;
          icon?: string | null;
          color?: string | null;
          difficulty_level?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          duration_days?: number;
          icon?: string | null;
          color?: string | null;
          difficulty_level?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      credit_transactions: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          reason: string | null;
          balance_after: number | null;
          created_at: string;
          request_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          reason?: string | null;
          balance_after?: number | null;
          created_at?: string;
          request_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          delta?: number;
          reason?: string | null;
          balance_after?: number | null;
          created_at?: string;
          request_id?: string | null;
        };
        Relationships: [];
      };
      // Note: the derived capacity snapshot table is intentionally excluded
      // from client types so `lib/capacity.ts` (`dailyLoad`) remains the sole
      // client source of truth (enforced by `capacitySingleSourceOfTruth.test.ts`).
      // @source live
      deep_work_sessions: {
        Row: {
          id: string;
          user_id: string;
          subject: string;
          duration_minutes: number;
          date: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject: string;
          duration_minutes: number;
          date: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          subject?: string;
          duration_minutes?: number;
          date?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      event_templates: {
        Row: {
          id: string;
          user_id: string;
          template_name: string;
          data: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_name: string;
          data: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_name?: string;
          data?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      events: {
        Row: {
          id: string;
          user_id: string;
          calendar_id: string;
          title: string;
          description: string | null;
          location: string | null;
          start_time: string;
          end_time: string;
          is_all_day: boolean;
          visibility: string;
          transparency: string;
          color_hex: string | null;
          category_type: string | null;
          attendees: Json;
          recurrence_rule: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          calendar_id: string;
          title: string;
          description?: string | null;
          location?: string | null;
          start_time: string;
          end_time: string;
          is_all_day?: boolean;
          visibility?: string;
          transparency?: string;
          color_hex?: string | null;
          category_type?: string | null;
          attendees?: Json;
          recurrence_rule?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          calendar_id?: string;
          title?: string;
          description?: string | null;
          location?: string | null;
          start_time?: string;
          end_time?: string;
          is_all_day?: boolean;
          visibility?: string;
          transparency?: string;
          color_hex?: string | null;
          category_type?: string | null;
          attendees?: Json;
          recurrence_rule?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      focus_sessions: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          task_title: string | null;
          mode: string;
          started_at: string;
          ended_at: string | null;
          planned_seconds: number;
          completed_seconds: number | null;
          completed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          task_title?: string | null;
          mode?: string;
          started_at: string;
          ended_at?: string | null;
          planned_seconds?: number;
          completed_seconds?: number | null;
          completed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string | null;
          task_title?: string | null;
          mode?: string;
          started_at?: string;
          ended_at?: string | null;
          planned_seconds?: number;
          completed_seconds?: number | null;
          completed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      focus_tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          completed: boolean;
          selected: boolean;
          estimated_pomodoros: number | null;
          completed_pomodoros: number | null;
          total_focus_seconds: number | null;
          color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          completed?: boolean;
          selected?: boolean;
          estimated_pomodoros?: number | null;
          completed_pomodoros?: number | null;
          total_focus_seconds?: number | null;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          completed?: boolean;
          selected?: boolean;
          estimated_pomodoros?: number | null;
          completed_pomodoros?: number | null;
          total_focus_seconds?: number | null;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      global_bosses: {
        Row: {
          id: number;
          name: string;
          description: string | null;
          max_hp: number;
          current_hp: number;
          is_active: boolean | null;
          reward_coins: number | null;
          reward_xp: number | null;
          end_time: string;
          created_at: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          description?: string | null;
          max_hp?: number;
          current_hp?: number;
          is_active?: boolean | null;
          reward_coins?: number | null;
          reward_xp?: number | null;
          end_time: string;
          created_at?: string | null;
        };
        Update: {
          id?: number;
          name?: string;
          description?: string | null;
          max_hp?: number;
          current_hp?: number;
          is_active?: boolean | null;
          reward_coins?: number | null;
          reward_xp?: number | null;
          end_time?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      goals: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          title: string;
          progress: number | null;
          year: number | null;
          quarter: number | null;
          month: number | null;
          archived: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          title: string;
          progress?: number | null;
          year?: number | null;
          quarter?: number | null;
          month?: number | null;
          archived?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          title?: string;
          progress?: number | null;
          year?: number | null;
          quarter?: number | null;
          month?: number | null;
          archived?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      google_calendar_integrations: {
        Row: {
          user_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string | null;
          scope: string | null;
          token_type: string | null;
          calendar_id: string | null;
          calendar_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          access_token: string;
          refresh_token?: string;
          expires_at?: string | null;
          scope?: string | null;
          token_type?: string | null;
          calendar_id?: string | null;
          calendar_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          access_token?: string;
          refresh_token?: string;
          expires_at?: string | null;
          scope?: string | null;
          token_type?: string | null;
          calendar_id?: string | null;
          calendar_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source migration:029
      habit_checklist_checks: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          item_id: string;
          day: string;
          checked_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          item_id: string;
          day: string;
          checked_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          item_id?: string;
          day?: string;
          checked_at?: string;
        };
        Relationships: [];
      };
      // @source migration:029
      habit_checklist_items: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          title: string;
          required: boolean;
          position: number;
          created_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          title: string;
          required?: boolean;
          position?: number;
          created_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          title?: string;
          required?: boolean;
          position?: number;
          created_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      habit_deletions: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          habit_name: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          habit_name?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          habit_name?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source migration:028
      habit_goal_versions: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          effective_from: string;
          frequency_config: Json;
          daily_goal: number | null;
          target_direction: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          effective_from: string;
          frequency_config: Json;
          daily_goal?: number | null;
          target_direction?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          effective_from?: string;
          frequency_config?: Json;
          daily_goal?: number | null;
          target_direction?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      habit_logs: {
        Row: {
          id: string;
          habit_id: string;
          user_id: string;
          completed_at: string;
          is_completed: boolean | null;
          current_streak: number | null;
          notes: string | null;
          mood_rating: number | null;
          created_at: string | null;
          photo_url: string | null;
          voice_note_url: string | null;
          caption: string | null;
          value: number | null;
          is_makeup: boolean | null;
          state: string;
          xp: number | null;
          // @source migration:033
          tz: string | null;
        };
        Insert: {
          id?: string;
          habit_id: string;
          user_id: string;
          completed_at: string;
          is_completed?: boolean | null;
          current_streak?: number | null;
          notes?: string | null;
          mood_rating?: number | null;
          created_at?: string | null;
          photo_url?: string | null;
          voice_note_url?: string | null;
          caption?: string | null;
          value?: number | null;
          is_makeup?: boolean | null;
          state?: string;
          xp?: number | null;
          // @source migration:033
          tz?: string | null;
        };
        Update: {
          id?: string;
          habit_id?: string;
          user_id?: string;
          completed_at?: string;
          is_completed?: boolean | null;
          current_streak?: number | null;
          notes?: string | null;
          mood_rating?: number | null;
          created_at?: string | null;
          photo_url?: string | null;
          voice_note_url?: string | null;
          caption?: string | null;
          value?: number | null;
          is_makeup?: boolean | null;
          state?: string;
          xp?: number | null;
          // @source migration:033
          tz?: string | null;
        };
        Relationships: [];
      };
      // @source migration:028
      habit_pauses: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string | null;
          kind: string;
          start_date: string;
          end_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id?: string | null;
          kind: string;
          start_date: string;
          end_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string | null;
          kind?: string;
          start_date?: string;
          end_date?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      habit_reminders: {
        Row: {
          id: string;
          habit_id: string | null;
          time: string;
          enabled: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          habit_id?: string | null;
          time: string;
          enabled?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          habit_id?: string | null;
          time?: string;
          enabled?: boolean | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      habit_templates: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          category: string | null;
          icon: string | null;
          habits: Json;
          created_at: string | null;
          color: string | null;
          main_category: string | null;
          sub_category: string | null;
          behavior_type: string | null;
          type: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          category?: string | null;
          icon?: string | null;
          habits: Json;
          created_at?: string | null;
          color?: string | null;
          main_category?: string | null;
          sub_category?: string | null;
          behavior_type?: string | null;
          type?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          category?: string | null;
          icon?: string | null;
          habits?: Json;
          created_at?: string | null;
          color?: string | null;
          main_category?: string | null;
          sub_category?: string | null;
          behavior_type?: string | null;
          type?: string | null;
        };
        Relationships: [];
      };
      // @source migration:036
      habit_xp_awards: {
        Row: {
          user_id: string;
          habit_id: string;
          day: string;
          xp_awarded: number;
          streak_counted: boolean;
          updated_at: string;
          // @source migration:038
          habit_fp: string | null;
        };
        Insert: {
          user_id: string;
          habit_id: string;
          day: string;
          xp_awarded?: number;
          streak_counted?: boolean;
          updated_at?: string;
          // @source migration:038
          habit_fp?: string | null;
        };
        Update: {
          user_id?: string;
          habit_id?: string;
          day?: string;
          xp_awarded?: number;
          streak_counted?: boolean;
          updated_at?: string;
          // @source migration:038
          habit_fp?: string | null;
        };
        Relationships: [];
      };
      // @source live
      habits: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          category: string | null;
          frequency: string | null;
          target_days: number[] | null;
          color: string | null;
          icon: string | null;
          streak_current: number | null;
          streak_best: number | null;
          strength_score: number | null;
          impact: number | null;
          difficulty: number | null;
          priority: string | null;
          status: string | null;
          is_active: boolean | null;
          created_at: string;
          streak_goal: number | null;
          preferred_time_of_day: string | null;
          domain: string | null;
          reminders: Json | null;
          goal_type: string | null;
          goal_date: string | null;
          goal_amount: number | null;
          goal_unit: string | null;
          behavior_type: string | null;
          tracking_type: string | null;
          unit: string | null;
          daily_goal: number | null;
          log_question: string | null;
          focus_score: number | null;
          habit_type: string | null;
          quit_date: string | null;
          cost_per_day: number | null;
          time_wasted_per_day: number | null;
          willpower_cost: number;
          target_direction: string | null;
          frequency_config: Json;
          end_condition: Json | null;
          impact_level: string | null;
          urgency: string | null;
          estimated_minutes: number | null;
          cue_habit_id: string | null;
          cue_note: string | null;
          life_area: string | null;
          install_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          category?: string | null;
          frequency?: string | null;
          target_days?: number[] | null;
          color?: string | null;
          icon?: string | null;
          streak_current?: number | null;
          streak_best?: number | null;
          strength_score?: number | null;
          impact?: number | null;
          difficulty?: number | null;
          priority?: string | null;
          status?: string | null;
          is_active?: boolean | null;
          created_at?: string;
          streak_goal?: number | null;
          preferred_time_of_day?: string | null;
          domain?: string | null;
          reminders?: Json | null;
          goal_type?: string | null;
          goal_date?: string | null;
          goal_amount?: number | null;
          goal_unit?: string | null;
          behavior_type?: string | null;
          tracking_type?: string | null;
          unit?: string | null;
          daily_goal?: number | null;
          log_question?: string | null;
          focus_score?: number | null;
          habit_type?: string | null;
          quit_date?: string | null;
          cost_per_day?: number | null;
          time_wasted_per_day?: number | null;
          willpower_cost?: number;
          target_direction?: string | null;
          frequency_config?: Json;
          end_condition?: Json | null;
          impact_level?: string | null;
          urgency?: string | null;
          estimated_minutes?: number | null;
          cue_habit_id?: string | null;
          cue_note?: string | null;
          life_area?: string | null;
          install_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          category?: string | null;
          frequency?: string | null;
          target_days?: number[] | null;
          color?: string | null;
          icon?: string | null;
          streak_current?: number | null;
          streak_best?: number | null;
          strength_score?: number | null;
          impact?: number | null;
          difficulty?: number | null;
          priority?: string | null;
          status?: string | null;
          is_active?: boolean | null;
          created_at?: string;
          streak_goal?: number | null;
          preferred_time_of_day?: string | null;
          domain?: string | null;
          reminders?: Json | null;
          goal_type?: string | null;
          goal_date?: string | null;
          goal_amount?: number | null;
          goal_unit?: string | null;
          behavior_type?: string | null;
          tracking_type?: string | null;
          unit?: string | null;
          daily_goal?: number | null;
          log_question?: string | null;
          focus_score?: number | null;
          habit_type?: string | null;
          quit_date?: string | null;
          cost_per_day?: number | null;
          time_wasted_per_day?: number | null;
          willpower_cost?: number;
          target_direction?: string | null;
          frequency_config?: Json;
          end_condition?: Json | null;
          impact_level?: string | null;
          urgency?: string | null;
          estimated_minutes?: number | null;
          cue_habit_id?: string | null;
          cue_note?: string | null;
          life_area?: string | null;
          install_id?: string | null;
        };
        Relationships: [];
      };
      // @source live
      journal_entries: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          content: string;
          mood: number | null;
          created_at: string;
          ai_summary: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          date?: string;
          content?: string;
          mood?: number | null;
          created_at?: string;
          ai_summary?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          content?: string;
          mood?: number | null;
          created_at?: string;
          ai_summary?: boolean;
        };
        Relationships: [];
      };
      // @source live
      journal_insights: {
        Row: {
          id: string;
          user_id: string;
          period: string;
          period_key: string;
          content: string;
          entry_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period: string;
          period_key: string;
          content: string;
          entry_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period?: string;
          period_key?: string;
          content?: string;
          entry_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      key_results: {
        Row: {
          id: string;
          okr_id: string;
          user_id: string;
          title: string;
          current_value: number;
          target_value: number;
          unit: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          okr_id: string;
          user_id: string;
          title: string;
          current_value?: number;
          target_value: number;
          unit?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          okr_id?: string;
          user_id?: string;
          title?: string;
          current_value?: number;
          target_value?: number;
          unit?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      life_area_logs: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          area: string;
          value: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          area: string;
          value: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          area?: string;
          value?: number;
        };
        Relationships: [];
      };
      // @source live
      monthly_reviews: {
        Row: {
          id: string;
          user_id: string;
          month_key: string;
          answers: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          month_key: string;
          answers?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          month_key?: string;
          answers?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source migration:031
      mood_checkins: {
        Row: {
          id: string;
          user_id: string;
          at: string;
          day: string;
          mood_id: string;
          label: string;
          valence: number;
          intensity: number;
          note: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          at: string;
          day: string;
          mood_id: string;
          label: string;
          valence: number;
          intensity: number;
          note?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          at?: string;
          day?: string;
          mood_id?: string;
          label?: string;
          valence?: number;
          intensity?: number;
          note?: string | null;
        };
        Relationships: [];
      };
      // @source migration:031
      mood_definitions: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string;
          valence: number;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          icon: string;
          valence: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          icon?: string;
          valence?: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      notes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          tags: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          content?: string;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      notion_integrations: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          workspace_id: string | null;
          workspace_name: string | null;
          workspace_icon: string | null;
          bot_id: string | null;
          habits_database_id: string | null;
          tasks_database_id: string | null;
          habits_url: string | null;
          tasks_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          access_token: string;
          workspace_id?: string | null;
          workspace_name?: string | null;
          workspace_icon?: string | null;
          bot_id?: string | null;
          habits_database_id?: string | null;
          tasks_database_id?: string | null;
          habits_url?: string | null;
          tasks_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          access_token?: string;
          workspace_id?: string | null;
          workspace_name?: string | null;
          workspace_icon?: string | null;
          bot_id?: string | null;
          habits_database_id?: string | null;
          tasks_database_id?: string | null;
          habits_url?: string | null;
          tasks_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      okrs: {
        Row: {
          id: string;
          user_id: string;
          objective: string;
          year: number;
          quarter: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          objective: string;
          year: number;
          quarter: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          objective?: string;
          year?: number;
          quarter?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      pet_stages: {
        Row: {
          id: number;
          name: string;
          description: string | null;
          min_level: number;
          icon: string;
          color: string;
        };
        Insert: {
          id?: number;
          name: string;
          description?: string | null;
          min_level: number;
          icon: string;
          color: string;
        };
        Update: {
          id?: number;
          name?: string;
          description?: string | null;
          min_level?: number;
          icon?: string;
          color?: string;
        };
        Relationships: [];
      };
      // @source live
      profile_badges: {
        Row: {
          id: string;
          user_id: string;
          badge_name: string;
          icon: string | null;
          description: string | null;
          earned_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          badge_name: string;
          icon?: string | null;
          description?: string | null;
          earned_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          badge_name?: string;
          icon?: string | null;
          description?: string | null;
          earned_at?: string;
        };
        Relationships: [];
      };
      // @source live
      profiles: {
        Row: {
          id: string;
          email: string | null;
          username: string | null;
          level: number | null;
          total_xp: number | null;
          current_level_xp: number | null;
          next_level_xp: number | null;
          willpower_rank: string | null;
          streak_record: number | null;
          created_at: string;
          makeup_credits: number | null;
          last_credit_reset: string | null;
          push_token: string | null;
          ai_persona: string | null;
          last_ai_context: string | null;
          coins: number | null;
          skill_points: number | null;
          purged_xp: number;
        };
        Insert: {
          id: string;
          email?: string | null;
          username?: string | null;
          level?: number | null;
          total_xp?: number | null;
          current_level_xp?: number | null;
          next_level_xp?: number | null;
          willpower_rank?: string | null;
          streak_record?: number | null;
          created_at?: string;
          makeup_credits?: number | null;
          last_credit_reset?: string | null;
          push_token?: string | null;
          ai_persona?: string | null;
          last_ai_context?: string | null;
          coins?: number | null;
          skill_points?: number | null;
          purged_xp?: number;
        };
        Update: {
          id?: string;
          email?: string | null;
          username?: string | null;
          level?: number | null;
          total_xp?: number | null;
          current_level_xp?: number | null;
          next_level_xp?: number | null;
          willpower_rank?: string | null;
          streak_record?: number | null;
          created_at?: string;
          makeup_credits?: number | null;
          last_credit_reset?: string | null;
          push_token?: string | null;
          ai_persona?: string | null;
          last_ai_context?: string | null;
          coins?: number | null;
          skill_points?: number | null;
          purged_xp?: number;
        };
        Relationships: [];
      };
      // @source live
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          description: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color?: string;
          description?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color?: string;
          description?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      quests: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          condition_type: string;
          target_value: number;
          reward_coins: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          condition_type: string;
          target_value: number;
          reward_coins: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          condition_type?: string;
          target_value?: number;
          reward_coins?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      reading_list: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          author: string | null;
          type: string;
          status: string;
          url: string | null;
          notes: string | null;
          rating: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          author?: string | null;
          type?: string;
          status?: string;
          url?: string | null;
          notes?: string | null;
          rating?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          author?: string | null;
          type?: string;
          status?: string;
          url?: string | null;
          notes?: string | null;
          rating?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      recovery_plans: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          source_date: string;
          target_date: string;
          strategy: string;
          note: string | null;
          reminder_time: string | null;
          status: string;
          created_at: string;
          source_log_id: string | null;
          deficit_type: string | null;
          deficit_value: number | null;
          distributed_days: Json | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          source_date: string;
          target_date: string;
          strategy?: string;
          note?: string | null;
          reminder_time?: string | null;
          status?: string;
          created_at?: string;
          source_log_id?: string | null;
          deficit_type?: string | null;
          deficit_value?: number | null;
          distributed_days?: Json | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          source_date?: string;
          target_date?: string;
          strategy?: string;
          note?: string | null;
          reminder_time?: string | null;
          status?: string;
          created_at?: string;
          source_log_id?: string | null;
          deficit_type?: string | null;
          deficit_value?: number | null;
          distributed_days?: Json | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      reminders: {
        Row: {
          id: string;
          event_id: string;
          trigger_minutes_before: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          trigger_minutes_before: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          trigger_minutes_before?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source migration:031
      review_next_actions: {
        Row: {
          id: string;
          user_id: string;
          week_key: string;
          kind: string;
          task_id: string | null;
          habit_id: string | null;
          label: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          week_key: string;
          kind: string;
          task_id?: string | null;
          habit_id?: string | null;
          label: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          week_key?: string;
          kind?: string;
          task_id?: string | null;
          habit_id?: string | null;
          label?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      routine_items: {
        Row: {
          id: string;
          routine_id: string;
          habit_template: Json;
        };
        Insert: {
          id?: string;
          routine_id: string;
          habit_template: Json;
        };
        Update: {
          id?: string;
          routine_id?: string;
          habit_template?: Json;
        };
        Relationships: [];
      };
      // @source migration:030
      routine_sessions: {
        Row: {
          id: string;
          user_id: string;
          template_id: string | null;
          template_version: number;
          template_name: string;
          steps: Json;
          results: Json;
          status: string;
          active_ms: number;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_id?: string | null;
          template_version: number;
          template_name: string;
          steps: Json;
          results?: Json;
          status: string;
          active_ms?: number;
          started_at: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_id?: string | null;
          template_version?: number;
          template_name?: string;
          steps?: Json;
          results?: Json;
          status?: string;
          active_ms?: number;
          started_at?: string;
          ended_at?: string | null;
        };
        Relationships: [];
      };
      // @source migration:030
      routine_template_versions: {
        Row: {
          id: string;
          user_id: string;
          template_id: string;
          version: number;
          steps: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_id: string;
          version: number;
          steps: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_id?: string;
          version?: number;
          steps?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source migration:030
      routine_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          created_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      routines: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          source: string;
          prompt: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          source?: string;
          prompt?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          source?: string;
          prompt?: string | null;
        };
        Relationships: [];
      };
      // @source live
      shop_items: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          price: number;
          icon: string;
          item_type: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          price: number;
          icon: string;
          item_type: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          price?: number;
          icon?: string;
          item_type?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      skills: {
        Row: {
          id: number;
          key: string;
          name: string;
          description: string | null;
          icon: string;
          max_level: number | null;
        };
        Insert: {
          id?: number;
          key: string;
          name: string;
          description?: string | null;
          icon: string;
          max_level?: number | null;
        };
        Update: {
          id?: number;
          key?: string;
          name?: string;
          description?: string | null;
          icon?: string;
          max_level?: number | null;
        };
        Relationships: [];
      };
      // @source live
      spotify_accounts: {
        Row: {
          user_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scope: string | null;
          spotify_user_id: string | null;
          display_name: string | null;
          product: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scope?: string | null;
          spotify_user_id?: string | null;
          display_name?: string | null;
          product?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          access_token?: string;
          refresh_token?: string;
          expires_at?: string;
          scope?: string | null;
          spotify_user_id?: string | null;
          display_name?: string | null;
          product?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          category: string | null;
          due_date: string | null;
          time_block_start: string | null;
          time_block_end: string | null;
          completed: boolean | null;
          completed_at: string | null;
          is_subtask: boolean | null;
          parent_task_id: string | null;
          created_at: string;
          updated_at: string | null;
          list_name: string | null;
          status: string | null;
          priority: string;
          list_type: string;
          project_id: string | null;
          notes_text: string | null;
          quadrant: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          category?: string | null;
          due_date?: string | null;
          time_block_start?: string | null;
          time_block_end?: string | null;
          completed?: boolean | null;
          completed_at?: string | null;
          is_subtask?: boolean | null;
          parent_task_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
          list_name?: string | null;
          status?: string | null;
          priority?: string;
          list_type?: string;
          project_id?: string | null;
          notes_text?: string | null;
          quadrant?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          category?: string | null;
          due_date?: string | null;
          time_block_start?: string | null;
          time_block_end?: string | null;
          completed?: boolean | null;
          completed_at?: string | null;
          is_subtask?: boolean | null;
          parent_task_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
          list_name?: string | null;
          status?: string | null;
          priority?: string;
          list_type?: string;
          project_id?: string | null;
          notes_text?: string | null;
          quadrant?: string | null;
        };
        Relationships: [];
      };
      // @source live
      user_gamification: {
        Row: {
          user_id: string;
          makeup_credits: number;
          last_credit_reset: string;
          created_at: string | null;
        };
        Insert: {
          user_id: string;
          makeup_credits?: number;
          last_credit_reset?: string;
          created_at?: string | null;
        };
        Update: {
          user_id?: string;
          makeup_credits?: number;
          last_credit_reset?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      user_onboarding: {
        Row: {
          user_id: string;
          onboarding_version: number;
          goals: string[];
          primary_barrier: string | null;
          pace: string | null;
          preferred_dayparts: string[];
          reminder_intent: boolean | null;
          status: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
          install_id: string | null;
          install_expected_habits: number | null;
          install_return_status: string | null;
        };
        Insert: {
          user_id: string;
          onboarding_version?: number;
          goals?: string[];
          primary_barrier?: string | null;
          pace?: string | null;
          preferred_dayparts?: string[];
          reminder_intent?: boolean | null;
          status?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          install_id?: string | null;
          install_expected_habits?: number | null;
          install_return_status?: string | null;
        };
        Update: {
          user_id?: string;
          onboarding_version?: number;
          goals?: string[];
          primary_barrier?: string | null;
          pace?: string | null;
          preferred_dayparts?: string[];
          reminder_intent?: boolean | null;
          status?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          install_id?: string | null;
          install_expected_habits?: number | null;
          install_return_status?: string | null;
        };
        Relationships: [];
      };
      // @source live
      user_subscriptions: {
        Row: {
          user_id: string;
          tier: string;
          billing_period: string | null;
          status: string;
          focus_points: number;
          monthly_grant: number;
          credits_period_end: string;
          sub_period_end: string | null;
          provider: string | null;
          provider_ref: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          tier?: string;
          billing_period?: string | null;
          status?: string;
          focus_points?: number;
          monthly_grant?: number;
          credits_period_end?: string;
          sub_period_end?: string | null;
          provider?: string | null;
          provider_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          tier?: string;
          billing_period?: string | null;
          status?: string;
          focus_points?: number;
          monthly_grant?: number;
          credits_period_end?: string;
          sub_period_end?: string | null;
          provider?: string | null;
          provider_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // @source live
      webhooks: {
        Row: {
          id: string;
          user_id: string;
          url: string;
          event_types: string[];
          headers: Json | null;
          enabled: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          url: string;
          event_types?: string[];
          headers?: Json | null;
          enabled?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          url?: string;
          event_types?: string[];
          headers?: Json | null;
          enabled?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      weekly_reviews: {
        Row: {
          id: string;
          user_id: string;
          week_key: string;
          wins: string | null;
          challenges: string | null;
          next_week: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          week_key: string;
          wins?: string | null;
          challenges?: string | null;
          next_week?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          week_key?: string;
          wins?: string | null;
          challenges?: string | null;
          next_week?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // @source live
      weekly_xp: {
        Row: {
          id: string;
          user_id: string;
          week_start: string;
          xp_earned: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          week_start: string;
          xp_earned?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          week_start?: string;
          xp_earned?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // @source live
      willpower_state: {
        Row: {
          user_id: string;
          state_date: string;
          daily_budget: number;
          used: number;
          focus_capacity: number;
          active_count: number;
        };
        Insert: {
          user_id: string;
          state_date?: string;
          daily_budget?: number;
          used?: number;
          focus_capacity?: number;
          active_count?: number;
        };
        Update: {
          user_id?: string;
          state_date?: string;
          daily_budget?: number;
          used?: number;
          focus_capacity?: number;
          active_count?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // @source live
      activate_subscription: {
        Args: {
          p_user_id: string;
          p_tier: string;
          p_period: string;
          p_provider?: string;
          p_provider_ref?: string | null;
        };
        Returns: Database['public']['Tables']['user_subscriptions']['Row'];
      };
      // @source live
      ai_request_begin: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_mode: string;
          p_fingerprint: string;
        };
        Returns: { outcome: string; response: Json | null; error: string | null }[];
      };
      // @source live
      ai_request_complete: {
        Args: { p_user_id: string; p_request_id: string; p_response: Json };
        Returns: boolean;
      };
      // @source live
      ai_request_fail: {
        Args: { p_user_id: string; p_request_id: string; p_error: string };
        Returns: boolean;
      };
      // @source live
      ai_request_reconcile_stale: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: number;
      };
      // @source live
      ai_request_release: {
        Args: { p_user_id: string; p_request_id: string };
        Returns: boolean;
      };
      // @source live
      get_global_leaderboard: {
        Args: { limit_val?: number };
        Returns: {
          user_id: string;
          username: string;
          level: number;
          total_xp: number;
          willpower_rank: string;
          rank: number;
        }[];
      };
      // @source live
      get_or_init_subscription: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['user_subscriptions']['Row'];
      };
      // @source live
      get_or_init_subscription_for: {
        Args: { p_user_id: string };
        Returns: Database['public']['Tables']['user_subscriptions']['Row'];
      };
      // @source migration:037
      get_today_bootstrap: {
        Args: { p_today?: string };
        Returns: Json;
      };
      // @source live
      get_user_rank: {
        Args: { target_user_id: string };
        Returns: { rank: number; total_xp: number; level: number }[];
      };
      // @source live
      get_weekly_leaderboard: {
        Args: { limit_val?: number };
        Returns: {
          user_id: string;
          username: string;
          level: number;
          total_xp: number;
          weekly_xp: number;
          willpower_rank: string;
          rank: number;
        }[];
      };
      // @source live
      mock_activate_subscription: {
        Args: { p_tier: string; p_period: string };
        Returns: Database['public']['Tables']['user_subscriptions']['Row'];
      };
      // @source live
      refund_focus_points: {
        Args: { p_user_id: string; p_request_id: string; p_reason: string };
        Returns: { ok: boolean; balance: number; already: boolean }[];
      };
      // @source live
      spend_focus_points_v2: {
        Args: { p_user_id: string; p_amount: number; p_reason: string; p_request_id: string };
        Returns: { ok: boolean; balance: number; replayed: boolean }[];
      };
      // @source migration:042
      spend_willpower: {
        Args: { p_day: string; p_amount: number; p_active_delta?: number | null; p_clamp?: boolean };
        Returns: Database['public']['Tables']['willpower_state']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type PublicTableName = keyof Database['public']['Tables'];
export type PublicFunctionName = keyof Database['public']['Functions'];

export type TableRow<T extends PublicTableName> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends PublicTableName> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends PublicTableName> = Database['public']['Tables'][T]['Update'];
