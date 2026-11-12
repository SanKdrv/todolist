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
import { createTask, deleteTask, listTasks, updateTask } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { Task, TaskListResponse } from '@/types/task'
import TaskForm from '@/components/TaskForm.vue'
import TaskItem from '@/components/TaskItem.vue'
import TaskListView from '@/views/TaskListView.vue'

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

function makeTasks(count: number, startId = 1): Task[] {
  return Array.from({ length: count }, (_, index) => makeTask({ id: startId + index }))
}

function filterButton(wrapper: ReturnType<typeof mountView>['wrapper'], label: string) {
  const button = wrapper
    .findAll('.filter-button')
    .find((candidate) => candidate.text() === label)
  if (button === undefined) {
    throw new Error(`Filter button "${label}" not found`)
  }
  return button
}

function pageControls(wrapper: ReturnType<typeof mountView>['wrapper']) {
  const buttons = wrapper
    .get('nav[aria-label="Пагинация"]')
    .findAll('.page-button')
  return { previous: buttons[0], next: buttons[1] }
}

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(TaskListView, { global: { plugins: [pinia] } })
  return { wrapper, pinia }
}

beforeEach(() => {
  createMock.mockReset()
  deleteMock.mockReset()
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

  it('renders filters with "Все" active by default', async () => {
    listMock.mockResolvedValue(makeList())

    const { wrapper } = mountView()
    await flushPromises()

    const group = wrapper.get('[role="group"][aria-label="Фильтр задач"]')
    const buttons = group.findAll('.filter-button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.text())).toEqual(['Все', 'Активные', 'Завершённые'])
    expect(filterButton(wrapper, 'Все').attributes('aria-pressed')).toBe('true')
    expect(filterButton(wrapper, 'Активные').attributes('aria-pressed')).toBe('false')
  })

  it('switches the filter through the store and updates the list', async () => {
    listMock
      .mockResolvedValueOnce(
        makeList({
          items: [
            makeTask({ id: 1, title: 'Активная 1' }),
            makeTask({ id: 2, title: 'Активная 2' }),
          ],
          total: 2,
        }),
      )
      .mockResolvedValueOnce(
        makeList({ items: [makeTask({ id: 3, title: 'Только активная' })], total: 1 }),
      )

    const { wrapper } = mountView()
    await flushPromises()

    await filterButton(wrapper, 'Активные').trigger('click')
    await flushPromises()

    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', offset: 0 }),
    )
    expect(wrapper.text()).toContain('Только активная')
    expect(wrapper.text()).not.toContain('Активная 1')
    expect(filterButton(wrapper, 'Активные').attributes('aria-pressed')).toBe('true')
    expect(filterButton(wrapper, 'Все').attributes('aria-pressed')).toBe('false')
  })

  it('does not refetch when the active filter is selected again', async () => {
    listMock.mockResolvedValue(makeList())

    const { wrapper } = mountView()
    await flushPromises()
    const calls = listMock.mock.calls.length

    await filterButton(wrapper, 'Все').trigger('click')
    await flushPromises()

    expect(listMock).toHaveBeenCalledTimes(calls)
  })

  it('shows page numbers and correct boundary states', async () => {
    listMock
      .mockResolvedValueOnce(makeList({ items: makeTasks(20), total: 45, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(5, 41), total: 45, offset: 40, has_more: false }),
      )

    const { wrapper, pinia } = mountView()
    await flushPromises()

    expect(wrapper.get('.page-info').text()).toBe('Страница 1 из 3')
    expect(pageControls(wrapper).previous.attributes('disabled')).toBeDefined()
    expect(pageControls(wrapper).next.attributes('disabled')).toBeUndefined()

    await useTasksStore(pinia).setPage(3)
    await flushPromises()

    expect(wrapper.get('.page-info').text()).toBe('Страница 3 из 3')
    expect(pageControls(wrapper).previous.attributes('disabled')).toBeUndefined()
    expect(pageControls(wrapper).next.attributes('disabled')).toBeDefined()
  })

  it('navigates forward and backward with the correct offsets', async () => {
    listMock
      .mockResolvedValueOnce(makeList({ items: makeTasks(20), total: 45, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
      )
      .mockResolvedValueOnce(
        makeList({ items: makeTasks(20), total: 45, offset: 0, has_more: true }),
      )

    const { wrapper } = mountView()
    await flushPromises()

    await pageControls(wrapper).next.trigger('click')
    await flushPromises()

    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }))
    expect(wrapper.get('.page-info').text()).toBe('Страница 2 из 3')
    expect(pageControls(wrapper).previous.attributes('disabled')).toBeUndefined()

    await pageControls(wrapper).previous.trigger('click')
    await flushPromises()

    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
    expect(wrapper.get('.page-info').text()).toBe('Страница 1 из 3')
  })

  it('keeps the list mounted and disables pagination during a background page load', async () => {
    listMock.mockResolvedValueOnce(
      makeList({ items: makeTasks(20), total: 45, has_more: true }),
    )

    const { wrapper } = mountView()
    await flushPromises()
    const itemElement = wrapper.get('.task-item').element

    const gate = deferred<TaskListResponse>()
    listMock.mockReturnValueOnce(gate.promise)
    await pageControls(wrapper).next.trigger('click')
    await flushPromises()

    expect(wrapper.get('.task-item').element).toBe(itemElement)
    expect(wrapper.findAll('li')).toHaveLength(20)
    expect(wrapper.get('[role="status"]').text()).toContain('Обновляем список')
    expect(pageControls(wrapper).previous.attributes('disabled')).toBeDefined()
    expect(pageControls(wrapper).next.attributes('disabled')).toBeDefined()

    gate.resolve(
      makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
    )
    await flushPromises()

    expect(wrapper.get('.page-info').text()).toBe('Страница 2 из 3')
    expect(pageControls(wrapper).next.attributes('disabled')).toBeUndefined()
  })

  it('does not make an extra page request on a repeated click while loading', async () => {
    listMock.mockResolvedValueOnce(
      makeList({ items: makeTasks(20), total: 45, has_more: true }),
    )

    const { wrapper } = mountView()
    await flushPromises()

    const gate = deferred<TaskListResponse>()
    listMock.mockReturnValueOnce(gate.promise)
    const next = pageControls(wrapper).next
    await next.trigger('click')
    await next.trigger('click')

    expect(listMock).toHaveBeenCalledTimes(2)

    gate.resolve(
      makeList({ items: makeTasks(20, 21), total: 45, offset: 20, has_more: true }),
    )
    await flushPromises()
  })

  it('keeps filters available and hides pagination for an empty filtered result', async () => {
    listMock
      .mockResolvedValueOnce(makeList())
      .mockResolvedValueOnce(makeList())

    const { wrapper } = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('Пока нет задач')

    await filterButton(wrapper, 'Активные').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('По выбранному фильтру задач нет')
    expect(wrapper.find('[role="group"][aria-label="Фильтр задач"]').exists()).toBe(true)
    expect(filterButton(wrapper, 'Активные').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('nav[aria-label="Пагинация"]').exists()).toBe(false)
  })

  it('moves to the previous page after deleting the last task of the last page', async () => {
    const firstPage = makeTasks(20)
    const lastTask = makeTask({ id: 21, title: 'Последняя' })
    listMock
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 21, has_more: true }))
      .mockResolvedValueOnce(
        makeList({ items: [lastTask], total: 21, offset: 20, has_more: false }),
      )

    const { wrapper } = mountView()
    await flushPromises()

    await pageControls(wrapper).next.trigger('click')
    await flushPromises()
    expect(wrapper.get('.page-info').text()).toBe('Страница 2 из 2')

    deleteMock.mockResolvedValueOnce(undefined)
    listMock
      .mockResolvedValueOnce(makeList({ items: [], total: 20, offset: 20, has_more: false }))
      .mockResolvedValueOnce(makeList({ items: firstPage, total: 20, offset: 0, has_more: false }))

    await wrapper.get('.task-delete').trigger('click')
    await flushPromises()

    expect(wrapper.get('.page-info').text()).toBe('Страница 1 из 1')
    expect(wrapper.findAll('li')).toHaveLength(20)
  })
})
