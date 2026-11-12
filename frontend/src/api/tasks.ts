/** Typed task endpoints (contract: `backend/app/api/v1/tasks.py`). */

import { http } from './client'
import type {
  Task,
  TaskCreate,
  TaskListParams,
  TaskListResponse,
  TaskUpdate,
} from '@/types/task'

export async function listTasks(params: TaskListParams = {}): Promise<TaskListResponse> {
  const { data } = await http.get<TaskListResponse>('/tasks', { params })
  return data
}

export async function getTask(taskId: number): Promise<Task> {
  const { data } = await http.get<Task>(`/tasks/${taskId}`)
  return data
}

export async function createTask(payload: TaskCreate): Promise<Task> {
  const { data } = await http.post<Task>('/tasks', payload)
  return data
}

export async function updateTask(taskId: number, payload: TaskUpdate): Promise<Task> {
  const { data } = await http.patch<Task>(`/tasks/${taskId}`, payload)
  return data
}

export async function deleteTask(taskId: number): Promise<void> {
  await http.delete(`/tasks/${taskId}`)
}
