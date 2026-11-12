import type { Mock } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { SessionResponse } from '@/types/api'

const SESSION: SessionResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  csrf_token: 'TOKEN',
  expires_at: '2026-12-12T00:00:00Z',
  is_new: true,
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

type GetSessionMock = Mock<() => Promise<SessionResponse>>

async function importApplication(getSession: GetSessionMock): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app"></div>'
  vi.resetModules()
  vi.doMock('@/api/session', () => ({ getSession }))

  await import('@/main')

  const root = document.querySelector<HTMLElement>('#app')
  if (root === null) {
    throw new Error('Missing #app root')
  }
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.doUnmock('@/api/session')
  vi.resetModules()
})

describe('application bootstrap', () => {
  it('shows the loading screen and does not mount before the session is ready', async () => {
    const gate = deferred<SessionResponse>()
    const getSession = vi.fn<() => Promise<SessionResponse>>()
    getSession.mockReturnValue(gate.promise)

    const root = await importApplication(getSession)

    expect(root.querySelector('.boot-screen')).not.toBeNull()
    expect(root.querySelector('.app-shell')).toBeNull()
    expect(getSession).toHaveBeenCalledTimes(1)

    gate.resolve(SESSION)

    await vi.waitFor(() => {
      expect(root.querySelector('.app-shell')).not.toBeNull()
    })

    expect(root.querySelector('.boot-screen')).toBeNull()
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('mounts the application after a successful bootstrap', async () => {
    const getSession = vi.fn<() => Promise<SessionResponse>>()
    getSession.mockResolvedValue(SESSION)

    const root = await importApplication(getSession)

    await vi.waitFor(() => {
      expect(root.querySelector('.app-shell')).not.toBeNull()
    })

    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('shows a readable error and does not retry automatically', async () => {
    const getSession = vi.fn<() => Promise<SessionResponse>>()
    getSession.mockRejectedValue(new ApiError('Backend is down', 0))

    const root = await importApplication(getSession)

    await vi.waitFor(() => {
      expect(root.querySelector('.boot-error')).not.toBeNull()
    })

    expect(root.textContent).toContain('Не удалось подключиться')
    expect(root.textContent).toContain('Backend is down')
    expect(root.textContent).toContain('Повторить')
    expect(root.querySelector('.boot-retry')).not.toBeNull()
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('mounts after a successful manual retry', async () => {
    const getSession = vi.fn<() => Promise<SessionResponse>>()
    getSession
      .mockRejectedValueOnce(new ApiError('Backend is down', 0))
      .mockResolvedValueOnce(SESSION)

    const root = await importApplication(getSession)

    await vi.waitFor(() => {
      expect(root.querySelector('.boot-retry')).not.toBeNull()
    })

    const button = root.querySelector<HTMLButtonElement>('.boot-retry')
    expect(button).not.toBeNull()
    button?.click()

    await vi.waitFor(() => {
      expect(root.querySelector('.app-shell')).not.toBeNull()
    })

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(root.querySelector('.boot-error')).toBeNull()
  })
})
