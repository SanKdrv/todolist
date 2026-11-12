/**
 * Task list store.
 *
 * Race strategy: every `fetchTasks()` gets a monotonically increasing
 * sequence number; only the newest response may change state. Older responses
 * (and their errors) are discarded, so fast filter/page switches cannot
 * overwrite fresher data. Requests are not cancelled — Axios has no
 * AbortController here; the sequence guard is enough for correctness.
 *
 * Mutations are deduplicated per action key: one in-flight operation per task
 * (update/toggle/delete) and one create at a time. A duplicate call is a
 * no-op. Every successful mutation refetches the current page; on failure the
 * already loaded items are kept untouched.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, toApiError } from '@/api/client'
import {
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  listTasks,
  updateTask as updateTaskRequest,
} from '@/api/tasks'
import type {
  Task,
  TaskCreate,
  TaskOrder,
  TaskSort,
  TaskStatus,
  TaskUpdate,
} from '@/types/task'

const DEFAULT_LIMIT = 20

/**
 * Highest offset that can still contain rows for the given total.
 * `total = 0` maps to 0 so an empty list stays on page 1.
 */
function lastPageOffset(total: number, limit: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, (Math.ceil(total / limit) - 1) * limit)
}

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([])
  const total = ref(0)
  const limit = ref(DEFAULT_LIMIT)
  const offset = ref(0)
  const statusFilter = ref<TaskStatus>('all')
  const sort = ref<TaskSort>('created_at')
  const order = ref<TaskOrder>('desc')

  const loading = ref(false)
  const mutating = ref(false)
  const error = ref<ApiError | null>(null)

  // Per-task mutation bookkeeping: which tasks are busy and why they failed.
  // The global `error` is reserved for list loading; task mutation failures
  // live here so one task's failure cannot hide the whole list.
  const pendingTaskIds = ref<ReadonlySet<number>>(new Set())
  const mutationErrors = ref<Partial<Record<number, ApiError>>>({})

  // Server's answer to "is there another page". Not derived from total,
  // because the API is the source of truth for has_more.
  const hasMore = ref(false)

  const hasPrevious = computed(() => offset.value > 0)
  const currentPage = computed(() => Math.floor(offset.value / limit.value) + 1)
  // An empty list still has a page 1, which keeps the UI simple.
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
  const isEmpty = computed(() => !loading.value && items.value.length === 0)
  const isFiltered = computed(() => statusFilter.value !== 'all')

  let fetchSequence = 0
  const pendingMutations = new Set<string>()

  function isTaskPending(taskId: number): boolean {
    return pendingTaskIds.value.has(taskId)
  }

  function mutationErrorFor(taskId: number): ApiError | null {
    return mutationErrors.value[taskId] ?? null
  }

  function clearMutationError(taskId: number): void {
    if (!(taskId in mutationErrors.value)) {
      return
    }
    const next = { ...mutationErrors.value }
    delete next[taskId]
    mutationErrors.value = next
  }

  function setTaskPending(taskId: number, pending: boolean): void {
    const next = new Set(pendingTaskIds.value)
    if (pending) {
      next.add(taskId)
    } else {
      next.delete(taskId)
    }
    pendingTaskIds.value = next
  }

  async function fetchTasks(): Promise<void> {
    const sequence = ++fetchSequence
    loading.value = true
    error.value = null

    // At most one corrective request per fetch: after the offset is clamped,
    // a still-invalid answer is applied as-is instead of looping.
    let corrected = false

    try {
      for (;;) {
        const response = await listTasks({
          status: statusFilter.value,
          sort: sort.value,
          order: order.value,
          limit: limit.value,
          offset: offset.value,
        })

        // A newer fetch was started while this one was in flight. Check before
        // touching any state, including the corrective offset update.
        if (sequence !== fetchSequence) {
          return
        }

        const lastOffset = lastPageOffset(response.total, response.limit)
        if (!corrected && response.offset > lastOffset) {
          // The page no longer exists (tasks were deleted elsewhere or the
          // session was reset). Drop this response, move to the last valid
          // page and refetch exactly once.
          corrected = true
          offset.value = lastOffset
          continue
        }

        items.value = response.items
        total.value = response.total
        limit.value = response.limit
        offset.value = response.offset
        hasMore.value = response.has_more
        return
      }
    } catch (reason: unknown) {
      if (sequence !== fetchSequence) {
        return
      }
      // Keep the last good page: a failed refresh must not wipe the list.
      error.value = toApiError(reason)
    } finally {
      if (sequence === fetchSequence) {
        loading.value = false
      }
    }
  }

  async function setStatusFilter(status: TaskStatus): Promise<void> {
    if (statusFilter.value === status) {
      return
    }
    statusFilter.value = status
    offset.value = 0
    await fetchTasks()
  }

  async function setPage(page: number): Promise<void> {
    const safePage = Number.isFinite(page) ? Math.trunc(page) : 1
    const boundedPage = Math.min(Math.max(1, safePage), totalPages.value)
    const nextOffset = (boundedPage - 1) * limit.value

    if (nextOffset === offset.value) {
      return
    }
    offset.value = nextOffset
    await fetchTasks()
  }

  async function nextPage(): Promise<void> {
    if (!hasMore.value) {
      return
    }
    offset.value += limit.value
    await fetchTasks()
  }

  async function previousPage(): Promise<void> {
    if (!hasPrevious.value) {
      return
    }
    offset.value = Math.max(0, offset.value - limit.value)
    await fetchTasks()
  }

  async function runMutation(
    key: string,
    operation: () => Promise<void>,
    taskId?: number,
  ): Promise<void> {
    if (pendingMutations.has(key)) {
      return
    }

    pendingMutations.add(key)
    mutating.value = true

    if (taskId !== undefined) {
      clearMutationError(taskId)
      setTaskPending(taskId, true)
    }

    try {
      await operation()
      await fetchTasks()
      // A successful task mutation (including its refetch) clears the error;
      // for a deleted task this also drops the stale entry.
      if (taskId !== undefined) {
        clearMutationError(taskId)
      }
    } catch (reason: unknown) {
      const normalized = toApiError(reason)
      if (taskId !== undefined) {
        mutationErrors.value = { ...mutationErrors.value, [taskId]: normalized }
      } else {
        error.value = normalized
      }
    } finally {
      pendingMutations.delete(key)
      if (taskId !== undefined) {
        setTaskPending(taskId, false)
      }
      mutating.value = pendingMutations.size > 0
    }
  }

  async function createTask(payload: TaskCreate): Promise<void> {
    await runMutation('create', async () => {
      await createTaskRequest(payload)
    })
  }

  async function updateTask(taskId: number, payload: TaskUpdate): Promise<void> {
    await runMutation(
      `task:${taskId}`,
      async () => {
        await updateTaskRequest(taskId, payload)
      },
      taskId,
    )
  }

  async function toggleTask(task: Task): Promise<void> {
    await updateTask(task.id, { is_completed: !task.is_completed })
  }

  async function deleteTask(taskId: number): Promise<void> {
    await runMutation(
      `task:${taskId}`,
      async () => {
        await deleteTaskRequest(taskId)
      },
      taskId,
    )
  }

  return {
    items,
    total,
    limit,
    offset,
    statusFilter,
    sort,
    order,
    loading,
    mutating,
    error,
    hasMore,
    hasPrevious,
    currentPage,
    totalPages,
    isEmpty,
    isFiltered,
    pendingTaskIds,
    mutationErrors,
    isTaskPending,
    mutationErrorFor,
    clearMutationError,
    fetchTasks,
    setStatusFilter,
    setPage,
    nextPage,
    previousPage,
    createTask,
    updateTask,
    toggleTask,
    deleteTask,
  }
})
