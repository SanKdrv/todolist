import { flushPromises, mount } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/tasks', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}))

import { ApiError } from '@/api/client'
import { deleteTask, listTasks, updateTask } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { Task, TaskListResponse } from '@/types/task'
import TaskItem from '@/components/TaskItem.vue'

const deleteMock = vi.mocked(deleteTask)
const listMock = vi.mocked(listTasks)
const updateMock = vi.mocked(updateTask)

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Купить молоко',
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

function createTestPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

function mountItem(task: Task, pinia: Pinia) {
  return mount(TaskItem, {
    props: { task },
    global: { plugins: [pinia] },
  })
}

beforeEach(() => {
  deleteMock.mockReset()
  listMock.mockReset()
  updateMock.mockReset()
})

describe('TaskItem', () => {
  it('renders an active task', () => {
    const pinia = createTestPinia()
    const task = makeTask()

    const wrapper = mountItem(task, pinia)

    expect(wrapper.get('.task-title').text()).toBe('Купить молоко')
    expect(wrapper.classes()).not.toContain('is-completed')
    expect(wrapper.get('.task-toggle').attributes('aria-pressed')).toBe('false')
  })

  it('renders a completed task with a pressed toggle', () => {
    const pinia = createTestPinia()
    const task = makeTask({ is_completed: true })

    const wrapper = mountItem(task, pinia)

    expect(wrapper.classes()).toContain('is-completed')
    expect(wrapper.get('.task-toggle').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.task-toggle').text()).toContain('✓')
  })

  it('provides distinct accessible labels for active and completed tasks', () => {
    const pinia = createTestPinia()
    const active = mountItem(makeTask(), pinia)
    const completed = mountItem(makeTask({ id: 2, is_completed: true }), pinia)

    expect(active.get('.task-toggle').attributes('aria-label')).toBe(
      'Отметить задачу «Купить молоко» выполненной',
    )
    expect(completed.get('.task-toggle').attributes('aria-label')).toBe(
      'Вернуть задачу «Купить молоко» в активные',
    )
    expect(active.get('.task-delete').attributes('aria-label')).toBe(
      'Удалить задачу «Купить молоко»',
    )
  })

  it('toggles the task through the store', async () => {
    const pinia = createTestPinia()
    const task = makeTask()
    const store = useTasksStore(pinia)
    const toggleSpy = vi.spyOn(store, 'toggleTask')
    updateMock.mockResolvedValue(makeTask({ is_completed: true }))
    listMock.mockResolvedValue(makeList({ items: [makeTask({ is_completed: true })], total: 1 }))

    const wrapper = mountItem(task, pinia)
    await wrapper.get('.task-toggle').trigger('click')
    await flushPromises()

    expect(toggleSpy).toHaveBeenCalledWith(task)
  })

  it('deletes the task through the store', async () => {
    const pinia = createTestPinia()
    const task = makeTask({ id: 7 })
    const store = useTasksStore(pinia)
    const deleteSpy = vi.spyOn(store, 'deleteTask')
    deleteMock.mockResolvedValue(undefined)
    listMock.mockResolvedValue(makeList())

    const wrapper = mountItem(task, pinia)
    await wrapper.get('.task-delete').trigger('click')
    await flushPromises()

    expect(deleteSpy).toHaveBeenCalledWith(7)
  })

  it('disables both buttons and shows progress while pending', async () => {
    const pinia = createTestPinia()
    const task = makeTask()
    const gate = deferred<Task>()
    updateMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const wrapper = mountItem(task, pinia)
    await wrapper.get('.task-toggle').trigger('click')

    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.get('.task-pending').text()).toContain('Сохраняем')
    expect(wrapper.get('.task-toggle').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-delete').attributes('disabled')).toBeDefined()

    gate.resolve(makeTask({ is_completed: true }))
    await flushPromises()

    expect(wrapper.find('.task-pending').exists()).toBe(false)
    expect(wrapper.get('.task-toggle').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.task-delete').attributes('disabled')).toBeUndefined()
  })

  it('does not start a second mutation on a repeated click while pending', async () => {
    const pinia = createTestPinia()
    const gate = deferred<Task>()
    updateMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const wrapper = mountItem(makeTask(), pinia)
    await wrapper.get('.task-toggle').trigger('click')
    await wrapper.get('.task-toggle').trigger('click')

    expect(updateMock).toHaveBeenCalledTimes(1)

    gate.resolve(makeTask({ is_completed: true }))
    await flushPromises()
  })

  it('shows a mutation error next to the task and re-enables the buttons', async () => {
    const pinia = createTestPinia()
    updateMock.mockRejectedValueOnce(new ApiError('Не удалось сохранить', 500))

    const wrapper = mountItem(makeTask(), pinia)
    await wrapper.get('.task-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.get('.task-error').attributes('role')).toBe('alert')
    expect(wrapper.get('.task-error').text()).toContain('Не удалось сохранить')
    expect(wrapper.get('.task-toggle').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.task-delete').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.task-pending').exists()).toBe(false)
  })

  it('keeps pending and error of one task independent from another task', async () => {
    const pinia = createTestPinia()
    const firstTask = makeTask({ id: 1, title: 'Первая' })
    const secondTask = makeTask({ id: 2, title: 'Вторая' })
    const gate = deferred<Task>()
    updateMock
      .mockReturnValueOnce(gate.promise)
      .mockRejectedValueOnce(new ApiError('Ошибка второй', 500))
    listMock.mockResolvedValue(makeList())

    const first = mountItem(firstTask, pinia)
    const second = mountItem(secondTask, pinia)

    await first.get('.task-toggle').trigger('click')
    expect(first.get('.task-toggle').attributes('disabled')).toBeDefined()

    await second.get('.task-toggle').trigger('click')
    await flushPromises()

    expect(second.get('.task-error').text()).toContain('Ошибка второй')
    expect(first.find('.task-error').exists()).toBe(false)
    expect(first.find('.task-pending').exists()).toBe(true)
    expect(second.find('.task-pending').exists()).toBe(false)

    gate.resolve(makeTask({ id: 1, is_completed: true }))
    await flushPromises()

    expect(first.get('.task-toggle').attributes('disabled')).toBeUndefined()
  })
})
