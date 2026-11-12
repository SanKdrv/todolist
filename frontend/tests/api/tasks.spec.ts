import { beforeEach, describe, expect, it } from 'vitest'

import { http, resetApiState, sessionHttp } from '@/api/client'
import { createTask, deleteTask, getTask, listTasks, updateTask } from '@/api/tasks'
import type { Task, TaskListResponse } from '@/types/task'

import {
  bodyOf,
  createMockAdapter,
  makeResponse,
  pathOf,
} from '../helpers/mock-adapter'
import type { MockAdapter, MockHandler } from '../helpers/mock-adapter'

const TASK: Task = {
  id: 7,
  title: 'Task',
  description: null,
  is_completed: false,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
}

const TASK_LIST: TaskListResponse = {
  items: [TASK],
  total: 1,
  limit: 20,
  offset: 0,
  has_more: false,
}

function install(handler: MockHandler): MockAdapter {
  const mock = createMockAdapter(handler)
  http.defaults.adapter = mock.adapter
  sessionHttp.defaults.adapter = mock.adapter
  return mock
}

function installDefaults(): MockAdapter {
  return install((config) => {
    if (config.method === 'get' && pathOf(config) === '/tasks') {
      return makeResponse(config, 200, TASK_LIST)
    }
    if (config.method === 'get') {
      return makeResponse(config, 200, TASK)
    }
    if (config.method === 'delete') {
      return makeResponse(config, 204, undefined)
    }
    return makeResponse(config, 200, TASK)
  })
}

beforeEach(() => {
  resetApiState()
})

describe('GET /tasks', () => {
  it('serializes query parameters', async () => {
    const mock = installDefaults()

    await listTasks({
      status: 'active',
      sort: 'created_at',
      order: 'asc',
      limit: 10,
      offset: 20,
    })

    const request = mock.requests[0]
    expect(request.method).toBe('get')
    expect(request.params).toEqual({
      status: 'active',
      sort: 'created_at',
      order: 'asc',
      limit: 10,
      offset: 20,
    })

    // Verify the query string axios would actually produce.
    const uri = http.getUri(request)
    expect(uri.split('?')[0].endsWith('/tasks')).toBe(true)

    const params = new URLSearchParams(uri.split('?')[1] ?? '')
    expect(params.get('status')).toBe('active')
    expect(params.get('sort')).toBe('created_at')
    expect(params.get('order')).toBe('asc')
    expect(params.get('limit')).toBe('10')
    expect(params.get('offset')).toBe('20')
  })

  it('sends no query string when no parameters are passed', async () => {
    const mock = installDefaults()

    await listTasks()

    expect(mock.requests[0].url).toBe('/tasks')
  })

  it('returns the list payload as-is', async () => {
    installDefaults()

    await expect(listTasks()).resolves.toEqual(TASK_LIST)
  })
})

describe('single task endpoints', () => {
  it('builds the task path', async () => {
    const mock = installDefaults()

    await getTask(7)

    expect(mock.requests[0].method).toBe('get')
    expect(mock.requests[0].url).toBe('/tasks/7')
  })
})

describe('mutations', () => {
  it('POSTs the create payload', async () => {
    const mock = installDefaults()

    await createTask({ title: 'New task', description: 'details', is_completed: false })

    const request = mock.requests[0]
    expect(request.method).toBe('post')
    expect(pathOf(request)).toBe('/tasks')
    expect(bodyOf(request)).toEqual({
      title: 'New task',
      description: 'details',
      is_completed: false,
    })
  })

  it('PATCHes only the provided field', async () => {
    const mock = installDefaults()

    await updateTask(7, { title: 'Renamed' })

    const request = mock.requests[0]
    expect(request.method).toBe('patch')
    expect(pathOf(request)).toBe('/tasks/7')
    expect(bodyOf(request)).toEqual({ title: 'Renamed' })
  })

  it('keeps description: null in the PATCH body', async () => {
    const mock = installDefaults()

    await updateTask(7, { description: null })

    expect(bodyOf(mock.requests[0])).toEqual({ description: null })
  })

  it('preserves is_completed: false', async () => {
    const mock = installDefaults()

    await updateTask(7, { is_completed: false })

    expect(bodyOf(mock.requests[0])).toEqual({ is_completed: false })
  })

  it('allows an empty PATCH object', async () => {
    const mock = installDefaults()

    await updateTask(7, {})

    expect(bodyOf(mock.requests[0])).toEqual({})
  })

  it('DELETEs the task and resolves with undefined for 204', async () => {
    const mock = installDefaults()

    await expect(deleteTask(7)).resolves.toBeUndefined()

    const request = mock.requests[0]
    expect(request.method).toBe('delete')
    expect(pathOf(request)).toBe('/tasks/7')
  })
})
