import { AxiosError } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/session', () => ({ getSession: vi.fn() }))

import { ApiError } from '@/api/client'
import { getSession } from '@/api/session'
import { useSessionStore } from '@/stores/session'
import type { SessionResponse } from '@/types/api'

const getSessionMock = vi.mocked(getSession)

const SESSION: SessionResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  csrf_token: 'TOKEN',
  expires_at: '2026-12-12T00:00:00Z',
  is_new: true,
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  setActivePinia(createPinia())
  getSessionMock.mockReset()
})

describe('initial state', () => {
  it('starts idle without a session or error', () => {
    const store = useSessionStore()

    expect(store.status).toBe('idle')
    expect(store.session).toBeNull()
    expect(store.error).toBeNull()
    expect(store.isReady).toBe(false)
    expect(getSessionMock).not.toHaveBeenCalled()
  })
})

describe('bootstrap', () => {
  it('stores the session and becomes ready', async () => {
    getSessionMock.mockResolvedValue(SESSION)
    const store = useSessionStore()

    await store.bootstrap()

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('ready')
    expect(store.session).toEqual(SESSION)
    expect(store.error).toBeNull()
    expect(store.isReady).toBe(true)
  })

  it('does not request the session again when already ready', async () => {
    getSessionMock.mockResolvedValue(SESSION)
    const store = useSessionStore()

    await store.bootstrap()
    await store.bootstrap()

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('ready')
  })

  it('shares one request between concurrent callers', async () => {
    const gate = deferred<SessionResponse>()
    getSessionMock.mockReturnValue(gate.promise)
    const store = useSessionStore()

    const first = store.bootstrap()
    const second = store.bootstrap()

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('loading')

    gate.resolve(SESSION)
    await Promise.all([first, second])

    expect(store.status).toBe('ready')
    expect(store.session).toEqual(SESSION)
  })

  it('never writes the session to web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    getSessionMock.mockResolvedValue(SESSION)
    const store = useSessionStore()

    await store.bootstrap()

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('errors', () => {
  it('stores the normalized error and allows a retry', async () => {
    const failure = new ApiError('Backend is down', 0)
    getSessionMock.mockRejectedValueOnce(failure).mockResolvedValueOnce(SESSION)
    const store = useSessionStore()

    await store.bootstrap()

    expect(store.status).toBe('error')
    expect(store.error).toBe(failure)
    expect(store.session).toBeNull()
    expect(store.isReady).toBe(false)

    await store.bootstrap()

    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(store.status).toBe('ready')
    expect(store.session).toEqual(SESSION)
    expect(store.error).toBeNull()
  })

  it('normalizes a network AxiosError into ApiError', async () => {
    getSessionMock.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    const store = useSessionStore()

    await store.bootstrap()

    expect(store.status).toBe('error')
    expect(store.error).toBeInstanceOf(ApiError)
    expect(store.error?.status).toBe(0)
    expect(store.error?.message).toBe('Не удалось связаться с сервером')
  })

  it('does not reject the bootstrap promise on failure', async () => {
    getSessionMock.mockRejectedValue(new ApiError('fail', 500))
    const store = useSessionStore()

    await expect(store.bootstrap()).resolves.toBeUndefined()
    expect(store.status).toBe('error')
  })
})
