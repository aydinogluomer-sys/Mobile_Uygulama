import axios from 'axios';
import { Habit, Task, Completion, Webhook, BadHabit, HeatmapData, Stats } from '../types';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const API_URL = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ==================== HABITS ====================
export const habitAPI = {
  getAll: async (): Promise<Habit[]> => {
    const response = await api.get('/habits');
    return response.data;
  },
  
  getById: async (id: string): Promise<Habit> => {
    const response = await api.get(`/habits/${id}`);
    return response.data;
  },
  
  create: async (habit: Partial<Habit>): Promise<Habit> => {
    const response = await api.post('/habits', habit);
    return response.data;
  },
  
  update: async (id: string, updates: Partial<Habit>): Promise<void> => {
    await api.patch(`/habits/${id}`, updates);
  },
  
  delete: async (id: string): Promise<void> => {
    await api.delete(`/habits/${id}`);
  },
  
  // Habit Sequencing
  activate: async (id: string): Promise<any> => {
    const response = await api.post(`/habits/${id}/activate`);
    return response.data;
  },
  
  pause: async (id: string): Promise<any> => {
    const response = await api.post(`/habits/${id}/pause`);
    return response.data;
  },
  
  getQueueStatus: async (): Promise<any> => {
    const response = await api.get('/habits/queue/status');
    return response.data;
  },
};

// ==================== COMPLETIONS ====================
export const completionAPI = {
  getAll: async (habitId?: string, days?: number): Promise<Completion[]> => {
    const params: any = {};
    if (habitId) params.habit_id = habitId;
    if (days) params.days = days;
    const response = await api.get('/completions', { params });
    return response.data;
  },
  
  create: async (completion: Partial<Completion>): Promise<Completion> => {
    const response = await api.post('/completions', completion);
    return response.data;
  },
  
  getHeatmap: async (habitId?: string): Promise<HeatmapData> => {
    const params: any = {};
    if (habitId) params.habit_id = habitId;
    const response = await api.get('/completions/heatmap', { params });
    return response.data;
  },
};

// ==================== TASKS ====================
export const taskAPI = {
  getAll: async (date?: string, completed?: boolean): Promise<Task[]> => {
    const params: any = {};
    if (date) params.date = date;
    if (completed !== undefined) params.completed = completed;
    const response = await api.get('/tasks', { params });
    return response.data;
  },
  
  create: async (task: Partial<Task>): Promise<Task> => {
    const response = await api.post('/tasks', task);
    return response.data;
  },
  
  update: async (id: string, updates: Partial<Task>): Promise<void> => {
    await api.patch(`/tasks/${id}`, updates);
  },
  
  delete: async (id: string): Promise<void> => {
    await api.delete(`/tasks/${id}`);
  },
  
  split: async (id: string, chunkMinutes?: number): Promise<{ subtasks: Task[] }> => {
    const response = await api.post(`/tasks/${id}/split`, { chunk_minutes: chunkMinutes });
    return response.data;
  },
};

// ==================== WEBHOOKS ====================
export const webhookAPI = {
  getAll: async (): Promise<Webhook[]> => {
    const response = await api.get('/webhooks');
    return response.data;
  },
  
  create: async (webhook: Partial<Webhook>): Promise<Webhook> => {
    const response = await api.post('/webhooks', webhook);
    return response.data;
  },
  
  delete: async (id: string): Promise<void> => {
    await api.delete(`/webhooks/${id}`);
  },
};

// ==================== BAD HABITS ====================
export const badHabitAPI = {
  getAll: async (): Promise<BadHabit[]> => {
    const response = await api.get('/bad-habits');
    return response.data;
  },
  
  create: async (badHabit: Partial<BadHabit>): Promise<BadHabit> => {
    const response = await api.post('/bad-habits', badHabit);
    return response.data;
  },
  
  getSavings: async (id: string): Promise<any> => {
    const response = await api.get(`/bad-habits/${id}/savings`);
    return response.data;
  },
};

// ==================== STATS ====================
export const statsAPI = {
  get: async (): Promise<Stats> => {
    const response = await api.get('/stats');
    return response.data;
  },
};

// ==================== USER PROFILE & GAMIFICATION ====================
export const profileAPI = {
  getProfile: async (): Promise<any> => {
    const response = await api.get('/user/profile');
    return response.data;
  },
  
  getAchievements: async (): Promise<any[]> => {
    const response = await api.get('/achievements');
    return response.data;
  },
};

// ==================== EXPORT ====================
export const exportAPI = {
  exportAll: async (): Promise<any> => {
    const response = await api.get('/export');
    return response.data;
  },
};

export default api;
