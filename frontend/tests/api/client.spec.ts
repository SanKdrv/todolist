import type { InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  CSRF_ERROR_DETAIL,
  bootstrapSession,
  http,
  resetApiState,
  sessionHttp,
} from '@/api/client'
import { getSession } from '@/api/session'
import { createTask, getTask, listTasks, updateTask } from '@/api/tasks'
import type { SessionResponse } from '@/types/api'
import type { Task } from '@/types/task'

import {
  bodyOf,
  createMockAdapter,
  csrfHeaderOf,
  deferred,
  makeError,
  makeResponse,
  networkError,
  pathOf,
} from '../helpers/mock-adapter'
import type { MockAdapter, MockHandler } from '../helpers/mock-adapter'

const SESSION: SessionResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  csrf_token: 'T1',
  expires_at: '2026-12-12T00:00:00Z',
  is_new: true,
}

const TASK: Task = {
  id: 1,
  title: 'Task',
  description: null,
  is_completed: false,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
}

const SESSION_REQUIRED = 'Active session required'

function install(handler: MockHandler): MockAdapter {
  const mock = createMockAdapter(handler)
  http.defaults.adapter = mock.adapter
  sessionHttp.defaults.adapter = mock.adapter
  return mock
}

function sessionCount(mock: MockAdapter): number {
  return mock.requests.filter((request) => pathOf(request) === '/session').length
}

function taskRequests(mock: MockAdapter): InternalAxiosRequestConfig[] {
  return mock.requests.filter((request) => pathOf(request) !== '/session')
}

beforeEach(() => {
  resetApiState()
  const unexpected: MockHandler = () => {
    throw new Error('Unexpected HTTP request in test')
  }
  http.defaults.adapter = createMockAdapter(unexpected).adapter
  sessionHttp.defaults.adapter = http.defaults.adapter
})

describe('CSRF header', () => {
  it('is attached to POST, PATCH and DELETE but not to GET', async () => {
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      if (config.method === 'get') {
        return makeResponse(config, 200, { items: [TASK], total: 1, limit: 20, offset: 0, has_more: false })
      }
      if (config.method === 'delete') {
        return makeResponse(config, 204, undefined)
      }
      return makeResponse(config, config.method === 'post' ? 201 : 200, TASK)
    })

    await getSession()
    await createTask({ title: 'created' })
    await updateTask(1, { title: 'updated' })
    await http.delete('/tasks/1')

    const writes = mock.requests.filter((request) => request.method !== 'get' && pathOf(request) !== '/session')
    expect(writes).toHaveLength(3)
    for (const request of writes) {
      expect(csrfHeaderOf(request)).toBe('T1')
    }

    await listTasks()
    await getTask(1)

    const reads = mock.requests.filter((request) => request.method === 'get' && pathOf(request) !== '/session')
    expect(reads).toHaveLength(2)
    for (const request of reads) {
      expect(csrfHeaderOf(request)).toBeFalsy()
    }
  })
})

describe('401 handling', () => {
  it('retries once and uses the token from bootstrap', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts === 1) {
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      return makeResponse(config, 201, TASK)
    })

    await createTask({ title: 'safe retry' })

    expect(attempts).toBe(2)
    expect(sessionCount(mock)).toBe(1)
    const retry = taskRequests(mock)[1]
    expect(csrfHeaderOf(retry)).toBe('T1')
  })

  it('shares one bootstrap between three simultaneous 401s', async () => {
    const gate = deferred<void>()
    let sessionCalls = 0
    let attempts = 0

    install(async (config) => {
      if (pathOf(config) === '/session') {
        sessionCalls += 1
        await gate.promise
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts <= 3) {
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      return makeResponse(config, 201, TASK)
    })

    const requests = [
      createTask({ title: 'a' }),
      createTask({ title: 'b' }),
      createTask({ title: 'c' }),
    ]

    await vi.waitFor(() => expect(attempts).toBe(3))
    gate.resolve()
    await Promise.all(requests)

    expect(sessionCalls).toBe(1)
    expect(attempts).toBe(6)
  })

  it('does not bootstrap for late 401s after another request refreshed the session', async () => {
    const gateB = deferred<void>()
    const gateC = deferred<void>()
    let sessionCalls = 0
    const attempts: Record<string, number> = {}

    install(async (config) => {
      if (pathOf(config) === '/session') {
        sessionCalls += 1
        return makeResponse(config, 200, SESSION)
      }

      const body = bodyOf(config) as { title: string }
      attempts[body.title] = (attempts[body.title] ?? 0) + 1

      if (body.title === 'B' && !config._retried) {
        await gateB.promise
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      if (body.title === 'C' && !config._retried) {
        await gateC.promise
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      if (body.title === 'A' && !config._retried) {
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      return makeResponse(config, 201, TASK)
    })

    // B and C are sent first: their configs carry generation 0.
    const pendingB = createTask({ title: 'B' })
    const pendingC = createTask({ title: 'C' })
    await vi.waitFor(() => expect(attempts.B).toBe(1))
    await vi.waitFor(() => expect(attempts.C).toBe(1))

    // A completes the only bootstrap while B and C are still waiting.
    await createTask({ title: 'A' })
    expect(sessionCalls).toBe(1)

    // Late 401s arrive when the token is already fresh.
    gateB.resolve()
    gateC.resolve()
    await Promise.all([pendingB, pendingC])

    expect(sessionCalls).toBe(1)
    expect(attempts).toEqual({ B: 2, C: 2, A: 2 })
  })

  it('does not retry a 401 more than once', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      throw makeError(config, 401, { detail: SESSION_REQUIRED })
    })

    await expect(createTask({ title: 'x' })).rejects.toMatchObject({ status: 401 })

    expect(attempts).toBe(2)
    expect(sessionCount(mock)).toBe(1)
  })

  it('rethrows the original 401 when bootstrap fails', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        throw networkError(config)
      }
      attempts += 1
      throw makeError(config, 401, { detail: SESSION_REQUIRED })
    })

    await expect(createTask({ title: 'x' })).rejects.toMatchObject({
      status: 401,
      message: SESSION_REQUIRED,
    })

    expect(attempts).toBe(1)
    expect(sessionCount(mock)).toBe(1)
  })

  it('does not execute the mutation twice for a retried POST', async () => {
    let attempts = 0
    let successes = 0
    install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts === 1) {
        throw makeError(config, 401, { detail: SESSION_REQUIRED })
      }
      successes += 1
      return makeResponse(config, 201, TASK)
    })

    await createTask({ title: 'once' })

    expect(attempts).toBe(2)
    expect(successes).toBe(1)
  })

  it('does not execute a POST twice after a CSRF 403', async () => {
    let attempts = 0
    let successes = 0
    install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts === 1) {
        throw makeError(config, 403, { detail: CSRF_ERROR_DETAIL })
      }
      successes += 1
      return makeResponse(config, 201, TASK)
    })

    await createTask({ title: 'csrf retry' })

    expect(attempts).toBe(2)
    expect(successes).toBe(1)
  })
})

describe('403 handling', () => {
  it('retries a CSRF 403 once with a refreshed token', async () => {
    let attempts = 0
    let successes = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts === 1) {
        throw makeError(config, 403, { detail: CSRF_ERROR_DETAIL })
      }
      successes += 1
      return makeResponse(config, 200, TASK)
    })

    await updateTask(1, { title: 'refreshed' })

    expect(attempts).toBe(2)
    expect(successes).toBe(1)
    expect(sessionCount(mock)).toBe(1)
    const retry = taskRequests(mock)[1]
    expect(csrfHeaderOf(retry)).toBe('T1')
  })

  it('does not bootstrap again for a late CSRF 403 after a refresh', async () => {
    const gate = deferred<void>()
    let sessionCalls = 0
    let attempts = 0

    install(async (config) => {
      if (pathOf(config) === '/session') {
        sessionCalls += 1
        return makeResponse(config, 200, SESSION)
      }
      attempts += 1
      if (attempts === 1) {
        await gate.promise
        throw makeError(config, 403, { detail: CSRF_ERROR_DETAIL })
      }
      return makeResponse(config, 200, TASK)
    })

    const pending = updateTask(1, { title: 'late' })
    await vi.waitFor(() => expect(attempts).toBe(1))

    // Another part of the app refreshes the session while the 403 is in flight.
    await bootstrapSession()
    expect(sessionCalls).toBe(1)

    gate.resolve()
    await pending

    expect(attempts).toBe(2)
    expect(sessionCalls).toBe(1)
  })

  it('does not bootstrap or retry an arbitrary 403', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        throw new Error('bootstrap must not run')
      }
      attempts += 1
      throw makeError(config, 403, { detail: 'Forbidden' })
    })

    await expect(createTask({ title: 'x' })).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })

    expect(attempts).toBe(1)
    expect(sessionCount(mock)).toBe(0)
  })
})

describe('non-auth errors', () => {
  it('does not bootstrap or retry on 422', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        throw new Error('bootstrap must not run')
      }
      attempts += 1
      throw makeError(config, 422, {
        detail: [{ type: 'value_error', loc: ['body', 'title'], msg: 'too short' }],
      })
    })

    const error = await createTask({ title: '' }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, message: 'too short' })
    expect((error as ApiError).issues).toHaveLength(1)
    expect(attempts).toBe(1)
    expect(sessionCount(mock)).toBe(0)
  })

  it('does not bootstrap or retry on 404', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        throw new Error('bootstrap must not run')
      }
      attempts += 1
      throw makeError(config, 404, { detail: 'Task not found' })
    })

    await expect(getTask(999)).rejects.toMatchObject({
      status: 404,
      message: 'Task not found',
    })

    expect(attempts).toBe(1)
    expect(sessionCount(mock)).toBe(0)
  })

  it('normalizes a network error without bootstrap', async () => {
    let attempts = 0
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        throw new Error('bootstrap must not run')
      }
      attempts += 1
      throw networkError(config)
    })

    await expect(listTasks()).rejects.toMatchObject({
      status: 0,
      message: 'Не удалось связаться с сервером',
    })

    expect(attempts).toBe(1)
    expect(sessionCount(mock)).toBe(0)
  })
})

describe('resetApiState', () => {
  it('ignores a bootstrap that finishes after reset', async () => {
    const gate = deferred<void>()
    let sessionCalls = 0

    const mock = install(async (config) => {
      if (pathOf(config) === '/session') {
        sessionCalls += 1
        if (sessionCalls === 1) {
          await gate.promise
          return makeResponse(config, 200, { ...SESSION, csrf_token: 'STALE' })
        }
        return makeResponse(config, 200, { ...SESSION, csrf_token: 'FRESH' })
      }
      return makeResponse(config, 201, TASK)
    })

    const pending = getSession()
    await vi.waitFor(() => expect(sessionCalls).toBe(1))

    resetApiState()
    gate.resolve()

    await expect(pending).rejects.toBeInstanceOf(ApiError)

    // The stale bootstrap must not have written its token.
    await createTask({ title: 'after reset' })
    expect(csrfHeaderOf(taskRequests(mock)[0])).toBeFalsy()

    const fresh = await getSession()
    expect(fresh.csrf_token).toBe('FRESH')

    await createTask({ title: 'with fresh token' })
    expect(csrfHeaderOf(taskRequests(mock)[1])).toBe('FRESH')
  })
})
