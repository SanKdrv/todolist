/**
 * Anonymous session store.
 *
 * The CSRF token never reaches this store: it stays inside the API client,
 * which attaches it to unsafe requests. Here we only keep the public session
 * data and the bootstrap status used by the boot screen.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, toApiError } from '@/api/client'
import { getSession } from '@/api/session'
import type { SessionResponse } from '@/types/api'

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('idle')
  const session = ref<SessionResponse | null>(null)
  const error = ref<ApiError | null>(null)

  const isReady = computed(() => status.value === 'ready' && session.value !== null)

  // Not reactive: only used to share one in-flight request between callers.
  let inFlight: Promise<void> | null = null

  /**
   * Fetch the session once and keep the store in a predictable state.
   *
   * - resolves only after the state is final (ready or error), never rejects;
   * - a ready store is not refetched;
   * - concurrent callers share the same promise;
   * - an error resets the way for an explicit retry.
   */
  function bootstrap(): Promise<void> {
    if (isReady.value) {
      return Promise.resolve()
    }
    if (inFlight !== null) {
      return inFlight
    }

    status.value = 'loading'
    error.value = null

    inFlight = getSession()
      .then((data) => {
        session.value = data
        status.value = 'ready'
      })
      .catch((reason: unknown) => {
        session.value = null
        error.value = toApiError(reason)
        status.value = 'error'
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
  }

  return { status, session, error, isReady, bootstrap }
})
