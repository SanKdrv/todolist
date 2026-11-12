import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/tasks', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}))

import { ApiError } from '@/api/client'
import { createTask, deleteTask, listTasks, updateTask } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { Task, TaskListResponse } from '@/types/task'

const createMock = vi.mocked(createTask)
const deleteMock = vi.mocked(deleteTask)
const listMock = vi.mocked(listTasks)
const updateMock = vi.mocked(updateTask)

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Task',
    description: null,
    is_completed: false,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    ...overrides,
  }
}

function makeList(overrides: Partial<TaskListResponse> = {}): TaskListResponse {
  return {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    has_more: false,
    ...overrides,
  }
}

function makeTasks(count: number, startId = 1): Task[] {
  return Array.from({ length: count }, (_, index) => makeTask({ id: startId + index }))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  createMock.mockReset()
  deleteMock.mockReset()
  listMock.mockReset()
  updateMock.mockReset()
})

describe('initial state', () => {
  it('starts with backend defaults and no data', () => {
    const store = useTasksStore()

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.limit).toBe(20)
    expect(store.offset).toBe(0)
    expect(store.statusFilter).toBe('all')
    expect(store.sort).toBe('created_at')
    expect(store.order).toBe('desc')
    expect(store.loading).toBe(false)
    expect(store.mutating).toBe(false)
    expect(store.error).toBeNull()
    expect(store.hasMore).toBe(false)
    expect(store.hasPrevious).toBe(false)
    expect(store.currentPage).toBe(1)
    expect(store.totalPages).toBe(1)
    expect(store.isEmpty).toBe(true)
    expect(store.isFiltered).toBe(false)
  })
})

describe('fetchTasks', () => {
  it('loads a page with the current parameters', async () => {
    const task = makeTask()
    listMock.mockResolvedValue(makeList({ items: [task], total: 1 }))

    const store = useTasksStore()
    await store.fetchTasks()

    expect(listMock).toHaveBeenCalledWith({
      status: 'all',
      sort: 'created_at',
      order: 'desc',
      limit: 20,
      offset: 0,
    })
    expect(store.items).toEqual([task])
    expect(store.total).toBe(1)
    expect(store.loading).toBe(false)
    expect(store.isEmpty).toBe(false)
    expect(store.hasMore).toBe(false)
  })

  it('handles an empty list', async () => {
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.fetchTasks()

    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.isEmpty).toBe(true)
    expect(store.totalPages).toBe(1)
    expect(store.hasMore).toBe(false)
  })

  it('keeps the previous page and sets a normalized error when refresh fails', async () => {
    const task = makeTask()
    listMock.mockResolvedValueOnce(makeList({ items: [task], total: 1 }))
    const failure = new ApiError('Backend is down', 500)
    listMock.mockRejectedValueOnce(failure)

    const store = useTasksStore()
    await store.fetchTasks()
    await store.fetchTasks()

    expect(store.items).toEqual([task])
    expect(store.total).toBe(1)
    expect(store.error).toBe(failure)
    expect(store.loading).toBe(false)
  })

  it('clears a previous error after a successful fetch', async () => {
    listMock.mockRejectedValueOnce(new ApiError('boom', 500))
    listMock.mockResolvedValueOnce(makeList({ items: [makeTask()], total: 1 }))

    const store = useTasksStore()
    await store.fetchTasks()
    expect(store.error).not.toBeNull()

    await store.fetchTasks()
    expect(store.error).toBeNull()
  })
})

describe('filters and pagination', () => {
  it('changes the filter, resets offset and refetches', async () => {
    listMock.mockResolvedValueOnce(makeList({ total: 45, items: makeTasks(20), has_more: true }))
    listMock.mockResolvedValueOnce(
      makeList({ total: 45, items: makeTasks(20), offset: 20, has_more: true }),
    )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    listMock.mockResolvedValueOnce(makeList({ total: 3, items: makeTasks(3) }))
    await store.setStatusFilter('active')

    expect(listMock).toHaveBeenLastCalledWith({
      status: 'active',
      sort: 'created_at',
      order: 'desc',
      limit: 20,
      offset: 0,
    })
    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.isFiltered).toBe(true)
  })

  it('does not refetch when the same filter is selected again', async () => {
    listMock.mockResolvedValue(makeList({ total: 1, items: [makeTask()] }))

    const store = useTasksStore()
    await store.fetchTasks()
    const calls = listMock.mock.calls.length

    await store.setStatusFilter('all')

    expect(listMock).toHaveBeenCalledTimes(calls)
  })

  it('clamps pages to the available range and skips the current page', async () => {
    listMock.mockResolvedValueOnce(makeList({ total: 45, items: makeTasks(20), has_more: true }))

    const store = useTasksStore()
    await store.fetchTasks()
    expect(store.totalPages).toBe(3)

    listMock.mockResolvedValueOnce(
      makeList({ total: 45, items: makeTasks(20, 21), offset: 40, has_more: false }),
    )
    await store.setPage(3)
    expect(store.offset).toBe(40)
    expect(store.currentPage).toBe(3)

    const calls = listMock.mock.calls.length
    await store.setPage(99)
    expect(listMock).toHaveBeenCalledTimes(calls)

    listMock.mockResolvedValueOnce(makeList({ total: 45, items: makeTasks(20), has_more: true }))
    await store.setPage(-5)
    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
  })

  it('moves to the last valid page when total shrinks below the current offset', async () => {
    const firstPage = makeTasks(20)
    listMock
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 45, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
      )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    listMock
      .mockResolvedValueOnce(makeList({ items: [], total: 20, offset: 20, has_more: false }))
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 20, offset: 0, has_more: false }))

    await store.fetchTasks()

    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.totalPages).toBe(1)
    expect(store.items).toEqual(firstPage)
    expect(store.loading).toBe(false)
    expect(listMock.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0 })
    expect(listMock).toHaveBeenCalledTimes(4)
  })

  it('resets offset to 0 when the list becomes empty', async () => {
    listMock.mockResolvedValueOnce(makeList({ items: makeTasks(1), total: 21, has_more: true }))
    listMock.mockResolvedValueOnce(
      makeList({ items: [makeTask({ id: 21 })], total: 21, offset: 20, has_more: false }),
    )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    listMock
      .mockResolvedValueOnce(makeList({ items: [], total: 0, offset: 20, has_more: false }))
      .mockResolvedValueOnce(makeList({ items: [], total: 0, offset: 0, has_more: false }))

    await store.fetchTasks()

    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.totalPages).toBe(1)
    expect(store.items).toEqual([])
    expect(store.isEmpty).toBe(true)
    expect(listMock).toHaveBeenCalledTimes(4)
  })

  it('navigates with next/previous and stops at the boundaries', async () => {
    listMock.mockResolvedValueOnce(makeList({ total: 45, items: makeTasks(20), has_more: true }))

    const store = useTasksStore()
    await store.fetchTasks()

    listMock.mockResolvedValueOnce(
      makeList({ total: 45, items: makeTasks(20, 21), offset: 20, has_more: false }),
    )
    await store.nextPage()
    expect(store.offset).toBe(20)
    expect(store.hasPrevious).toBe(true)

    let calls = listMock.mock.calls.length
    await store.nextPage()
    expect(listMock).toHaveBeenCalledTimes(calls)
    expect(store.offset).toBe(20)

    listMock.mockResolvedValueOnce(makeList({ total: 45, items: makeTasks(20), has_more: true }))
    await store.previousPage()
    expect(store.offset).toBe(0)

    calls = listMock.mock.calls.length
    await store.previousPage()
    expect(listMock).toHaveBeenCalledTimes(calls)
    expect(store.offset).toBe(0)
  })
})

describe('mutations', () => {
  it('creates a task and refreshes the list', async () => {
    const created = makeTask({ id: 2, title: 'New task' })
    createMock.mockResolvedValue(created)
    listMock.mockResolvedValue(makeList({ items: [created], total: 1 }))

    const store = useTasksStore()
    const result = await store.createTask({ title: 'New task' })

    expect(result).toEqual({ status: 'created', task: created })
    expect(createMock).toHaveBeenCalledWith({ title: 'New task' })
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(store.items).toEqual([created])
    expect(store.mutating).toBe(false)
  })

  it('resets pagination to the first page after a successful create', async () => {
    listMock
      .mockResolvedValueOnce(makeList({ items: makeTasks(20), total: 45, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
      )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    const created = makeTask({ id: 50, title: 'New task' })
    createMock.mockResolvedValue(created)
    listMock.mockResolvedValueOnce(
      makeList({ items: [created], total: 46, offset: 0, has_more: true }),
    )

    const result = await store.createTask({ title: 'New task' })

    expect(result).toEqual({ status: 'created', task: created })
    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('returns created even when the follow-up refetch fails', async () => {
    const existing = makeTask({ id: 1, title: 'Existing' })
    listMock.mockResolvedValueOnce(makeList({ items: [existing], total: 1 }))

    const store = useTasksStore()
    await store.fetchTasks()

    const created = makeTask({ id: 2, title: 'New task' })
    createMock.mockResolvedValue(created)
    listMock.mockRejectedValueOnce(new ApiError('refresh failed', 500))

    const result = await store.createTask({ title: 'New task' })

    expect(result).toEqual({ status: 'created', task: created })
    expect(store.error?.message).toBe('refresh failed')
    expect(store.items).toEqual([existing])
    expect(store.mutating).toBe(false)
  })

  it('returns the POST error and leaves the loading error untouched', async () => {
    const loadFailure = new ApiError('list failed', 500)
    listMock.mockRejectedValueOnce(loadFailure)

    const store = useTasksStore()
    await store.fetchTasks()
    expect(store.error).toBe(loadFailure)

    const createFailure = new ApiError('create failed', 422)
    createMock.mockRejectedValueOnce(createFailure)

    const result = await store.createTask({ title: '' })

    expect(result).toEqual({ status: 'error', error: createFailure })
    expect(store.error).toBe(loadFailure)
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('returns skipped for a concurrent create and keeps mutating semantics', async () => {
    const gate = deferred<Task>()
    createMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    const first = store.createTask({ title: 'first' })

    expect(store.mutating).toBe(true)
    await expect(store.createTask({ title: 'second' })).resolves.toEqual({
      status: 'skipped',
    })
    expect(createMock).toHaveBeenCalledTimes(1)

    gate.resolve(makeTask())
    await first

    expect(store.mutating).toBe(false)
  })

  it('keeps mutating true until the create refetch completes', async () => {
    const createGate = deferred<Task>()
    const listGate = deferred<TaskListResponse>()
    createMock.mockReturnValueOnce(createGate.promise)
    listMock.mockReturnValueOnce(listGate.promise)

    const store = useTasksStore()
    const promise = store.createTask({ title: 'x' })

    expect(store.mutating).toBe(true)

    createGate.resolve(makeTask())
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
    expect(store.mutating).toBe(true)

    listGate.resolve(makeList())
    await promise

    expect(store.mutating).toBe(false)
  })

  it('updates only the provided fields and refreshes', async () => {
    const updated = makeTask({ title: 'Renamed' })
    updateMock.mockResolvedValue(updated)
    listMock.mockResolvedValue(makeList({ items: [updated], total: 1 }))

    const store = useTasksStore()
    await store.updateTask(1, { title: 'Renamed' })

    expect(updateMock).toHaveBeenCalledWith(1, { title: 'Renamed' })
    expect(store.items).toEqual([updated])
  })

  it('toggles is_completed through a partial update', async () => {
    const active = makeTask({ is_completed: false })
    const completed = makeTask({ is_completed: true })
    updateMock.mockResolvedValue(completed)
    listMock.mockResolvedValue(makeList({ items: [completed], total: 1 }))

    const store = useTasksStore()
    await store.toggleTask(active)

    expect(updateMock).toHaveBeenCalledWith(1, { is_completed: true })
    expect(store.items[0].is_completed).toBe(true)
  })

  it('deletes a task and refreshes', async () => {
    deleteMock.mockResolvedValue(undefined)
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.deleteTask(1)

    expect(deleteMock).toHaveBeenCalledWith(1)
    expect(store.items).toEqual([])
  })

  it('steps back a page when deleting the last item of the last page', async () => {
    const firstPage = makeTasks(20)
    const lastTask = makeTask({ id: 21 })
    listMock
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 21, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: [lastTask], total: 21, offset: 20, has_more: false }),
      )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    deleteMock.mockResolvedValue(undefined)
    // The API answers the stale offset with an empty page, then the store
    // corrects the page and refetches it.
    listMock
      .mockResolvedValueOnce(makeList({ items: [], total: 20, offset: 20, has_more: false }))
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 20, offset: 0, has_more: false }))
    await store.deleteTask(lastTask.id)

    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(listMock.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0 })
    expect(store.items).toEqual(firstPage)
  })

  it('normalizes the page after two parallel deletes empty the last page', async () => {
    const pageOne = makeTasks(20)
    const lastPage = makeTasks(2, 21)
    listMock
      .mockResolvedValueOnce(makeList({ items: pageOne, total: 22, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: lastPage, total: 22, offset: 20, has_more: false }),
      )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    deleteMock.mockResolvedValue(undefined)
    listMock.mockImplementation(async (params) => {
      if ((params?.offset ?? 0) === 20) {
        return makeList({ items: [], total: 20, offset: 20, has_more: false })
      }
      return makeList({ items: pageOne, total: 20, offset: 0, has_more: false })
    })

    await Promise.all([store.deleteTask(21), store.deleteTask(22)])

    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(store.offset).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.totalPages).toBe(1)
    expect(store.items).toEqual(pageOne)
    expect(store.loading).toBe(false)
    expect(store.mutating).toBe(false)
    expect(listMock.mock.calls.some(([params]) => params?.offset === 0)).toBe(true)
  })

  it('keeps the list intact and returns the error when create fails', async () => {
    const task = makeTask()
    listMock.mockResolvedValueOnce(makeList({ items: [task], total: 1 }))
    const failure = new ApiError('bad request', 422)
    createMock.mockRejectedValue(failure)

    const store = useTasksStore()
    await store.fetchTasks()
    const listCalls = listMock.mock.calls.length

    const result = await store.createTask({ title: '' })

    expect(result).toEqual({ status: 'error', error: failure })
    expect(store.items).toEqual([task])
    expect(store.total).toBe(1)
    expect(store.error).toBeNull()
    expect(store.mutating).toBe(false)
    expect(listMock).toHaveBeenCalledTimes(listCalls)
  })

  it('deduplicates parallel mutations of the same task', async () => {
    const active = makeTask({ is_completed: false })
    const completed = makeTask({ is_completed: true })
    const gate = deferred<Task>()
    updateMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList({ items: [completed], total: 1 }))

    const store = useTasksStore()
    const first = store.toggleTask(active)
    const second = store.toggleTask(active)

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(store.mutating).toBe(true)

    gate.resolve(completed)
    await Promise.all([first, second])

    expect(store.mutating).toBe(false)
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('allows mutations of different tasks in parallel', async () => {
    updateMock.mockResolvedValue(makeTask())
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await Promise.all([
      store.updateTask(1, { title: 'a' }),
      store.updateTask(2, { title: 'b' }),
    ])

    expect(updateMock).toHaveBeenCalledTimes(2)
  })
})

describe('per-task mutation state', () => {
  it('marks only the mutated task as pending', async () => {
    const gate = deferred<Task>()
    updateMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    const mutation = store.updateTask(1, { title: 'renamed' })

    expect(store.isTaskPending(1)).toBe(true)
    expect(store.isTaskPending(2)).toBe(false)

    gate.resolve(makeTask())
    await mutation

    expect(store.isTaskPending(1)).toBe(false)
  })

  it('keeps the task pending until the mutation refetch finishes', async () => {
    const updateGate = deferred<Task>()
    const listGate = deferred<TaskListResponse>()
    updateMock.mockReturnValueOnce(updateGate.promise)
    listMock.mockReturnValueOnce(listGate.promise)

    const store = useTasksStore()
    const mutation = store.updateTask(1, { title: 'renamed' })

    updateGate.resolve(makeTask())
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))

    expect(store.isTaskPending(1)).toBe(true)

    listGate.resolve(makeList({ items: [makeTask()], total: 1 }))
    await mutation

    expect(store.isTaskPending(1)).toBe(false)
  })

  it('releases pending after a failed mutation', async () => {
    const failure = new ApiError('update failed', 500)
    updateMock.mockRejectedValueOnce(failure)
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.updateTask(1, { title: 'renamed' })

    expect(store.isTaskPending(1)).toBe(false)
    expect(store.mutationErrorFor(1)).toBe(failure)
  })

  it('does not write task mutation errors into the global error', async () => {
    const loadFailure = new ApiError('list failed', 500)
    listMock.mockRejectedValueOnce(loadFailure)

    const store = useTasksStore()
    await store.fetchTasks()
    expect(store.error).toBe(loadFailure)

    updateMock.mockRejectedValueOnce(new ApiError('toggle failed', 500))
    await store.updateTask(1, { title: 'renamed' })

    expect(store.error).toBe(loadFailure)
    expect(store.mutationErrorFor(1)?.message).toBe('toggle failed')
  })

  it('clears a previous task error when the mutation is retried', async () => {
    updateMock.mockRejectedValueOnce(new ApiError('first attempt', 500))
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.updateTask(1, { title: 'first' })
    expect(store.mutationErrorFor(1)?.message).toBe('first attempt')

    updateMock.mockResolvedValueOnce(makeTask())
    await store.updateTask(1, { title: 'second' })

    expect(store.mutationErrorFor(1)).toBeNull()
  })

  it('keeps errors of different tasks independent', async () => {
    updateMock
      .mockRejectedValueOnce(new ApiError('task 1 failed', 500))
      .mockRejectedValueOnce(new ApiError('task 2 failed', 500))
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.updateTask(1, { title: 'a' })
    await store.updateTask(2, { title: 'b' })

    expect(store.mutationErrorFor(1)?.message).toBe('task 1 failed')
    expect(store.mutationErrorFor(2)?.message).toBe('task 2 failed')
  })

  it('tracks pending state for parallel mutations independently', async () => {
    const firstGate = deferred<Task>()
    const secondGate = deferred<Task>()
    updateMock.mockReturnValueOnce(firstGate.promise).mockReturnValueOnce(secondGate.promise)
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    const first = store.updateTask(1, { title: 'a' })
    const second = store.updateTask(2, { title: 'b' })

    expect(store.isTaskPending(1)).toBe(true)
    expect(store.isTaskPending(2)).toBe(true)
    expect(store.mutating).toBe(true)

    firstGate.resolve(makeTask({ id: 1 }))
    await first

    expect(store.isTaskPending(1)).toBe(false)
    expect(store.isTaskPending(2)).toBe(true)

    secondGate.resolve(makeTask({ id: 2 }))
    await second

    expect(store.isTaskPending(1)).toBe(false)
    expect(store.isTaskPending(2)).toBe(false)
    expect(store.mutating).toBe(false)
  })

  it('clears the mutation error of the deleted task after a successful retry', async () => {
    deleteMock.mockRejectedValueOnce(new ApiError('delete failed', 500))
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.deleteTask(5)
    expect(store.mutationErrorFor(5)?.message).toBe('delete failed')

    deleteMock.mockResolvedValueOnce(undefined)
    await store.deleteTask(5)

    expect(store.mutationErrorFor(5)).toBeNull()
  })

  it('clearMutationError removes only the requested task error', async () => {
    updateMock
      .mockRejectedValueOnce(new ApiError('task 1 failed', 500))
      .mockRejectedValueOnce(new ApiError('task 2 failed', 500))
    listMock.mockResolvedValue(makeList())

    const store = useTasksStore()
    await store.updateTask(1, { title: 'a' })
    await store.updateTask(2, { title: 'b' })

    store.clearMutationError(1)

    expect(store.mutationErrorFor(1)).toBeNull()
    expect(store.mutationErrorFor(2)?.message).toBe('task 2 failed')
  })
})

describe('races', () => {
  it('ignores a stale response that arrives after a newer one', async () => {
    const older = deferred<TaskListResponse>()
    const newer = deferred<TaskListResponse>()
    const oldTask = makeTask({ id: 1, title: 'old' })
    const newTask = makeTask({ id: 2, title: 'new' })

    listMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    const store = useTasksStore()
    const firstFetch = store.fetchTasks()
    const secondFetch = store.setStatusFilter('active')

    newer.resolve(makeList({ items: [newTask], total: 1 }))
    await secondFetch

    older.resolve(makeList({ items: [oldTask], total: 1 }))
    await firstFetch

    expect(store.items).toEqual([newTask])
    expect(store.statusFilter).toBe('active')
    expect(store.loading).toBe(false)
  })

  it('ignores an invalid stale page instead of correcting it', async () => {
    listMock
      .mockResolvedValueOnce(makeList({ items: makeTasks(20), total: 45, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
      )

    const store = useTasksStore()
    await store.fetchTasks()
    await store.setPage(2)
    expect(store.offset).toBe(20)

    const older = deferred<TaskListResponse>()
    const newer = deferred<TaskListResponse>()
    listMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

    const first = store.fetchTasks()
    const second = store.fetchTasks()
    const callsBefore = listMock.mock.calls.length

    older.resolve(makeList({ items: [], total: 20, offset: 20, has_more: false }))
    await first

    // Stale answer must not clamp offset, trigger a correction or touch state.
    expect(store.offset).toBe(20)
    expect(store.total).toBe(45)
    expect(listMock).toHaveBeenCalledTimes(callsBefore)
    expect(store.loading).toBe(true)
    expect(store.error).toBeNull()

    newer.resolve(makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }))
    await second

    expect(store.loading).toBe(false)
    expect(store.offset).toBe(20)
    expect(store.items).toEqual(makeTasks(20, 21))
  })

  it('lets a mutation refetch win over a list fetch already in flight', async () => {
    const initialFetch = deferred<TaskListResponse>()
    const created = makeTask({ id: 2, title: 'created' })

    listMock
      .mockReturnValueOnce(initialFetch.promise)
      .mockResolvedValueOnce(makeList({ items: [created], total: 1 }))
    createMock.mockResolvedValue(created)

    const store = useTasksStore()
    const pendingFetch = store.fetchTasks()
    await store.createTask({ title: 'created' })

    expect(store.items).toEqual([created])

    initialFetch.resolve(makeList({ items: [], total: 0 }))
    await pendingFetch

    expect(store.items).toEqual([created])
    expect(store.loading).toBe(false)
  })
})
