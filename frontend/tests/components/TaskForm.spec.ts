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
import { createTask, listTasks } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { Task, TaskListResponse } from '@/types/task'
import TaskForm from '@/components/TaskForm.vue'

const createMock = vi.mocked(createTask)
const listMock = vi.mocked(listTasks)

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Задача',
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

function mountFormWithPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(TaskForm, { global: { plugins: [pinia] } })
  return { wrapper, pinia }
}

function mountForm() {
  return mountFormWithPinia().wrapper
}

function titleInput(wrapper: ReturnType<typeof mountForm>) {
  return wrapper.get('#task-title')
}

function descriptionInput(wrapper: ReturnType<typeof mountForm>) {
  return wrapper.get('#task-description')
}

beforeEach(() => {
  createMock.mockReset()
  listMock.mockReset()
})

describe('TaskForm', () => {
  it('has accessible labels and a 200 character title limit', () => {
    const wrapper = mountForm()

    expect(wrapper.get('label[for="task-title"]').text()).toContain('Название')
    expect(wrapper.get('label[for="task-description"]').text()).toContain('Описание')
    expect(titleInput(wrapper).attributes('maxlength')).toBe('200')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Добавить задачу')
  })

  it('creates a task, trims values and clears the form on success', async () => {
    createMock.mockResolvedValue(makeTask())
    listMock.mockResolvedValue(makeList({ items: [makeTask()], total: 1 }))

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('  Купить хлеб  ')
    await descriptionInput(wrapper).setValue('  батон  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledWith({
      title: 'Купить хлеб',
      description: 'батон',
    })
    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('rejects an empty title after trim and keeps the input', async () => {
    const wrapper = mountForm()
    await titleInput(wrapper).setValue('    ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Введите название задачи')
    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('    ')
  })

  it('sends null when the description is empty', async () => {
    createMock.mockResolvedValue(makeTask())
    listMock.mockResolvedValue(makeList())

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('Задача')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledWith({ title: 'Задача', description: null })
  })

  it('rejects a title longer than 200 characters', async () => {
    const wrapper = mountForm()
    await titleInput(wrapper).setValue('x'.repeat(201))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('200 символов')
  })

  it('blocks a second submit and shows the loading state while creating', async () => {
    const gate = deferred<Task>()
    createMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('Задача')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')

    expect(createMock).toHaveBeenCalledTimes(1)
    const button = wrapper.get('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toContain('Сохраняем')

    gate.resolve(makeTask())
    await flushPromises()

    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('shows an API error and preserves the entered data', async () => {
    createMock.mockRejectedValueOnce(new ApiError('Сервер недоступен', 500))

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('Важная задача')
    await descriptionInput(wrapper).setValue('Подробности')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Сервер недоступен')
    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('Важная задача')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('Подробности')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('clears the error after a successful retry', async () => {
    createMock
      .mockRejectedValueOnce(new ApiError('Сервер недоступен', 500))
      .mockResolvedValueOnce(makeTask())
    listMock.mockResolvedValue(makeList())

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('Задача')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('')
  })

  it('clears the form when the POST succeeds but the refetch fails', async () => {
    createMock.mockResolvedValueOnce(makeTask())
    listMock.mockRejectedValueOnce(new ApiError('refresh failed', 500))

    const wrapper = mountForm()
    await titleInput(wrapper).setValue('Задача')
    await descriptionInput(wrapper).setValue('Описание')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('keeps the input when an in-flight create makes the submit skipped', async () => {
    const gate = deferred<Task>()
    createMock.mockReturnValueOnce(gate.promise)
    listMock.mockResolvedValue(makeList())

    const { wrapper, pinia } = mountFormWithPinia()
    const store = useTasksStore(pinia)
    const external = store.createTask({ title: 'Внешняя задача' })

    await titleInput(wrapper).setValue('Форма')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    expect((titleInput(wrapper).element as HTMLInputElement).value).toBe('Форма')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    gate.resolve(makeTask())
    await external
    await flushPromises()
  })
})
