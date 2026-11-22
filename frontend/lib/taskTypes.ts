export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low' | 'none';
export type ListType = 'inbox' | 'this_week' | 'someday';
export type QuadrantType = 'UI' | 'NI' | 'UN' | 'NN' | null;

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string | null;
  project_id?: string | null;
  list_type: ListType;
  notes_text?: string | null;
  completed: boolean;
  completed_at?: string | null;
  quadrant?: QuadrantType;
  created_at: string;
  updated_at?: string | null;
};
