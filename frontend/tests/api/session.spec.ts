import { beforeEach, describe, expect, it } from 'vitest'

import { http, resetApiState, sessionHttp } from '@/api/client'
import { getSession } from '@/api/session'
import { createTask } from '@/api/tasks'
import type { SessionResponse } from '@/types/api'
import type { Task } from '@/types/task'

import {
  createMockAdapter,
  csrfHeaderOf,
  makeResponse,
  pathOf,
} from '../helpers/mock-adapter'
import type { MockAdapter, MockHandler } from '../helpers/mock-adapter'

const SESSION: SessionResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  csrf_token: 'SESSION_TOKEN',
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

function install(handler: MockHandler): MockAdapter {
  const mock = createMockAdapter(handler)
  http.defaults.adapter = mock.adapter
  sessionHttp.defaults.adapter = mock.adapter
  return mock
}

function sessionCount(mock: MockAdapter): number {
  return mock.requests.filter((request) => pathOf(request) === '/session').length
}

beforeEach(() => {
  resetApiState()
})

describe('getSession', () => {
  it('returns the session and keeps its token for later requests', async () => {
    const mock = install((config) => {
      if (pathOf(config) === '/session') {
        return makeResponse(config, 200, SESSION)
      }
      return makeResponse(config, 201, TASK)
    })

    const session = await getSession()
    expect(session).toEqual(SESSION)

    await createTask({ title: 'with token' })

    const write = mock.requests.find((request) => pathOf(request) === '/tasks')
    expect(write).toBeDefined()
    expect(csrfHeaderOf(write)).toBe(SESSION.csrf_token)
    expect(sessionCount(mock)).toBe(1)
  })

  it('does not cache the session between calls', async () => {
    const mock = install((config) => makeResponse(config, 200, SESSION))

    await getSession()
    await getSession()

    expect(sessionCount(mock)).toBe(2)
  })
})
