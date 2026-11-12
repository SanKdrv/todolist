/**
 * Task contracts mirrored from `backend/app/schemas/task.py`.
 *
 * `description` is the only nullable field. For `TaskUpdate`, omitted fields
 * mean "do not change", while `description: null` clears the description.
 */

export type TaskStatus = 'all' | 'active' | 'completed'
export type TaskSort = 'created_at'
export type TaskOrder = 'asc' | 'desc'

export interface Task {
  id: number
  title: string
  description: string | null
  is_completed: boolean
  /** ISO 8601, UTC. */
  created_at: string
  /** ISO 8601, UTC. */
  updated_at: string
}

export interface TaskCreate {
  title: string
  description?: string | null
  is_completed?: boolean
}

export interface TaskUpdate {
  title?: string
  description?: string | null
  is_completed?: boolean
}

export interface TaskListResponse {
  items: Task[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export interface TaskListParams {
  status?: TaskStatus
  sort?: TaskSort
  order?: TaskOrder
  limit?: number
  offset?: number
}
