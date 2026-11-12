import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/tasks', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}))

import { ApiError } from '@/api/client'
import { createTask, listTasks, updateTask } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { Task, TaskListResponse } from '@/types/task'
import TaskForm from '@/components/TaskForm.vue'
import TaskItem from '@/components/TaskItem.vue'
import TaskListView from '@/views/TaskListView.vue'

const createMock = vi.mocked(createTask)
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

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(TaskListView, { global: { plugins: [pinia] } })
  return { wrapper, pinia }
}

beforeEach(() => {
  createMock.mockReset()
  listMock.mockReset()
  updateMock.mockReset()
})

describe('TaskListView', () => {
  it('shows the loading state before tasks arrive', async () => {
    const gate = deferred<TaskListResponse>()
    listMock.mockReturnValue(gate.promise)

    const { wrapper } = mountView()
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('Загрузка задач')
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(TaskForm).exists()).toBe(true)
  })

  it('renders tasks and the total count after loading', async () => {
    listMock.mockResolvedValue(
      makeList({
        items: [
          makeTask({ id: 1, title: 'Купить молоко' }),
          makeTask({ id: 2, title: 'Позвонить в сервис' }),
        ],
        total: 2,
      }),
    )

    const { wrapper } = mountView()
    await flushPromises()

    const items = wrapper.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Купить молоко')
    expect(items[1].text()).toContain('Позвонить в сервис')
    expect(wrapper.text()).toContain('Всего задач: 2')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAllComponents(TaskItem)).toHaveLength(2)
  })

  it('visually distinguishes completed tasks from active ones', async () => {
    listMock.mockResolvedValue(
      makeList({
        items: [
          makeTask({ id: 1, title: 'Активная', is_completed: false }),
          makeTask({ id: 2, title: 'Выполненная', is_completed: true }),
        ],
        total: 2,
      }),
    )

    const { wrapper } = mountView()
    await flushPromises()

    const items = wrapper.findAll('li')
    expect(items[0].classes()).not.toContain('is-completed')
    expect(items[1].classes()).toContain('is-completed')
    expect(items[0].get('.task-toggle').attributes('aria-pressed')).toBe('false')
    expect(items[1].get('.task-toggle').attributes('aria-pressed')).toBe('true')
  })

  it('shows a mutation error inline without hiding the list', async () => {
    listMock.mockResolvedValue(
      makeList({
        items: [
          makeTask({ id: 1, title: 'Первая' }),
          makeTask({ id: 2, title: 'Вторая' }),
        ],
        total: 2,
      }),
    )
    updateMock.mockRejectedValueOnce(new ApiError('Не удалось сохранить', 500))

    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.findAll('.task-toggle')[0].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.find('.status-error').exists()).toBe(false)
    expect(wrapper.get('.task-error').text()).toContain('Не удалось сохранить')
  })

  it('shows a dedicated empty state for an empty list', async () => {
    listMock.mockResolvedValue(makeList())

    const { wrapper } = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Пока нет задач')
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findComponent(TaskForm).exists()).toBe(true)
  })

  it('shows a filtered empty message when a filter is active', async () => {
    listMock.mockResolvedValue(makeList())

    const { wrapper, pinia } = mountView()
    await flushPromises()

    const store = useTasksStore(pinia)
    store.statusFilter = 'active'
    listMock.mockResolvedValueOnce(makeList())
    await store.fetchTasks()
    await flushPromises()

    expect(wrapper.text()).toContain('По выбранному фильтру задач нет')
  })

  it('creates a task through the form and refreshes the list', async () => {
    listMock.mockResolvedValueOnce(makeList())
    const created = makeTask({ id: 5, title: 'Новая задача' })
    createMock.mockResolvedValueOnce(created)
    listMock.mockResolvedValueOnce(makeList({ items: [created], total: 1 }))

    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.get('#task-title').setValue('Новая задача')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledWith({ title: 'Новая задача', description: null })
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Новая задача')
    expect((wrapper.get('#task-title').element as HTMLInputElement).value).toBe('')
  })

  it('does not resubmit when a successful create is followed by a failed refetch', async () => {
    listMock.mockResolvedValueOnce(makeList())
    createMock.mockResolvedValueOnce(makeTask({ id: 5, title: 'Новая' }))
    listMock.mockRejectedValueOnce(new ApiError('refresh failed', 500))

    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.get('#task-title').setValue('Новая')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    expect((wrapper.get('#task-title').element as HTMLInputElement).value).toBe('')
    expect(wrapper.getComponent(TaskForm).find('.form-error').exists()).toBe(false)
    expect(wrapper.text()).toContain('Не удалось загрузить задачи')

    await flushPromises()
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('shows the error message instead of an empty list', async () => {
    listMock.mockRejectedValue(new ApiError('Backend is down', 0))

    const { wrapper } = mountView()
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Не удалось загрузить задачи')
    expect(alert.text()).toContain('Backend is down')
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.findComponent(TaskForm).exists()).toBe(true)
  })

  it('reloads tasks when the retry button is pressed', async () => {
    listMock
      .mockRejectedValueOnce(new ApiError('Backend is down', 0))
      .mockResolvedValueOnce(makeList({ items: [makeTask({ title: 'После повтора' })], total: 1 }))

    const { wrapper } = mountView()
    await flushPromises()

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(listMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('После повтора')
  })

  it('keeps tasks mounted while a background reload is in flight', async () => {
    listMock.mockResolvedValueOnce(
      makeList({ items: [makeTask({ id: 1, title: 'Старая задача' })], total: 1 }),
    )

    const { wrapper, pinia } = mountView()
    await flushPromises()
    const itemElement = wrapper.get('.task-item').element
    expect(wrapper.findAll('li')).toHaveLength(1)

    const gate = deferred<TaskListResponse>()
    listMock.mockReturnValueOnce(gate.promise)
    const store = useTasksStore(pinia)
    const reload = store.fetchTasks()
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('Обновляем список')
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.get('.task-item').element).toBe(itemElement)
    expect(wrapper.text()).toContain('Старая задача')
    expect(wrapper.findComponent(TaskForm).exists()).toBe(true)

    gate.resolve(makeList({ items: [makeTask({ id: 1, title: 'Новая задача' })], total: 1 }))
    await reload
    await flushPromises()

    expect(wrapper.get('.task-item').element).toBe(itemElement)
    expect(wrapper.text()).toContain('Новая задача')
    expect(wrapper.text()).not.toContain('Старая задача')
  })

  it('keeps TaskItem mounted and pending visible during the post-mutation refetch', async () => {
    listMock.mockResolvedValueOnce(
      makeList({ items: [makeTask({ id: 1, title: 'Задача' })], total: 1 }),
    )
    updateMock.mockResolvedValue(makeTask({ id: 1, title: 'Задача', is_completed: true }))
    const refetch = deferred<TaskListResponse>()
    listMock.mockReturnValueOnce(refetch.promise)

    const { wrapper } = mountView()
    await flushPromises()
    const itemElement = wrapper.get('.task-item').element

    await wrapper.get('.task-toggle').trigger('click')
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))

    expect(wrapper.find('.task-item').exists()).toBe(true)
    expect(wrapper.get('.task-item').element).toBe(itemElement)
    expect(wrapper.get('.task-pending').text()).toContain('Сохраняем')
    expect(wrapper.get('[role="status"]').text()).toContain('Обновляем список')

    refetch.resolve(
      makeList({ items: [makeTask({ id: 1, title: 'Задача', is_completed: true })], total: 1 }),
    )
    await flushPromises()

    expect(wrapper.get('.task-item').element).toBe(itemElement)
    expect(wrapper.find('.task-pending').exists()).toBe(false)
  })

  it('keeps loaded tasks when a background refresh fails', async () => {
    listMock.mockResolvedValueOnce(
      makeList({ items: [makeTask({ id: 1, title: 'Задача' })], total: 1 }),
    )
    updateMock.mockResolvedValue(makeTask({ id: 1, title: 'Задача', is_completed: true }))
    listMock.mockRejectedValueOnce(new ApiError('Не удалось обновить', 500))

    const { wrapper } = mountView()
    await flushPromises()
    await wrapper.get('.task-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Задача')
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Не удалось обновить список')
    expect(alert.text()).toContain('Не удалось обновить')
    expect(wrapper.findComponent(TaskForm).exists()).toBe(true)

    listMock.mockResolvedValueOnce(
      makeList({ items: [makeTask({ id: 1, title: 'Задача', is_completed: true })], total: 1 }),
    )
    await alert.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Задача')
  })
})
