/**
 * Axios transport for TaskFlow.
 *
 * Responsibilities:
 * - attach the session CSRF token to unsafe requests;
 * - single-flight `GET /api/v1/session` bootstrap;
 * - one retry on 401 and on CSRF-specific 403;
 * - normalize every transport error into `ApiError`.
 *
 * The CSRF token lives in memory only. The session itself is an HttpOnly
 * cookie managed by the backend; JavaScript never reads it.
 */

import axios, { AxiosError } from 'axios'
import type { AxiosRequestConfig } from 'axios'

import type {
  ApiErrorPayload,
  ApiValidationIssue,
  SessionResponse,
} from '@/types/api'

// `_authGeneration` and `_retried` are internal retry bookkeeping.
// The generic default must match axios' own declaration.
declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface InternalAxiosRequestConfig<D = any> {
    _authGeneration?: number
    _retried?: boolean
  }
}

const BASE_URL = '/api/v1'
const CSRF_HEADER = 'X-CSRF-Token'
const REQUEST_TIMEOUT_MS = 15_000
const UNSAFE_METHODS = new Set(['post', 'patch', 'delete'])

/** Exact backend detail for a failed CSRF check (`app/api/deps.py`). */
export const CSRF_ERROR_DETAIL = 'CSRF token missing or invalid'

let authGeneration = 0
let csrfToken: string | null = null
let bootstrapPromise: Promise<SessionResponse> | null = null

export class ApiError extends Error {
  readonly status: number
  readonly issues: ApiValidationIssue[]

  constructor(
    message: string,
    status: number,
    issues: ApiValidationIssue[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

export const http = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS,
})

/**
 * Bare instance for the bootstrap call. It has no interceptors on purpose:
 * a failure of `GET /session` must not trigger another bootstrap or a retry.
 *
 * Exported only so tests can install a mock adapter.
 */
export const sessionHttp = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS,
})

function detailOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('detail' in data)) {
    return null
  }
  const detail = (data as ApiErrorPayload).detail
  return typeof detail === 'string' ? detail : null
}

function issuesOf(data: unknown): ApiValidationIssue[] {
  if (typeof data !== 'object' || data === null || !('detail' in data)) {
    return []
  }
  const detail = (data as ApiErrorPayload).detail
  return Array.isArray(detail) ? detail : []
}

/** Map anything thrown by axios into the single error type used by the app. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }

  if (axios.isAxiosError(error)) {
    const response = error.response
    if (!response) {
      return new ApiError('Не удалось связаться с сервером', 0, [], { cause: error })
    }

    const issues = issuesOf(response.data)
    const message =
      detailOf(response.data) ?? issues[0]?.msg ?? `Ошибка запроса (${response.status})`
    return new ApiError(message, response.status, issues, { cause: error })
  }

  if (error instanceof Error) {
    return new ApiError(error.message, 0, [], { cause: error })
  }

  return new ApiError('Неизвестная ошибка', 0, [], { cause: error })
}

function isRetryableAuthError(error: AxiosError): boolean {
  const status = error.response?.status
  if (status === 401) {
    return true
  }
  if (status === 403) {
    return detailOf(error.response?.data) === CSRF_ERROR_DETAIL
  }
  return false
}

http.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase()
  config._authGeneration = authGeneration

  if (UNSAFE_METHODS.has(method) && csrfToken !== null) {
    config.headers.set(CSRF_HEADER, csrfToken)
  }
  return config
})

async function fetchSession(generation: number): Promise<SessionResponse> {
  const { data } = await sessionHttp.get<SessionResponse>('/session')

  // A reset bumped the generation while the request was in flight: the stale
  // response must not overwrite the new (or cleared) auth state.
  if (generation !== authGeneration) {
    throw new ApiError('Session state was reset during bootstrap', 0)
  }

  csrfToken = data.csrf_token
  authGeneration += 1
  return data
}

/**
 * One shared `GET /session` for every concurrent auth failure.
 *
 * The returned promise is cached until it settles. The cleanup compares
 * identity, so a bootstrap started after `resetApiState()` is never cleared
 * by the older in-flight promise.
 */
export function bootstrapSession(): Promise<SessionResponse> {
  if (bootstrapPromise !== null) {
    return bootstrapPromise
  }

  const generation = authGeneration
  const tracked = fetchSession(generation).finally(() => {
    if (bootstrapPromise === tracked) {
      bootstrapPromise = null
    }
  })
  bootstrapPromise = tracked
  return tracked
}

/**
 * Forget client-side auth state (tests, future "new session" action).
 *
 * The HttpOnly cookie is not touched: JavaScript cannot clear it. The next
 * bootstrap simply re-reads the session from the backend.
 */
export function resetApiState(): void {
  authGeneration += 1
  csrfToken = null
  bootstrapPromise = null
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config

    // Never retry twice, never retry non-auth failures, never retry requests
    // without a config (e.g. cancellation before the adapter).
    if (!config || config._retried || !isRetryableAuthError(error)) {
      throw toApiError(error)
    }

    // Mark before awaiting: a second 401/403 on the replay must not retry again.
    config._retried = true

    const stale = config._authGeneration !== authGeneration
    // `csrfToken === null` means a reset, not a refresh: bootstrap anyway.
    const alreadyRefreshed = stale && csrfToken !== null

    if (!alreadyRefreshed) {
      try {
        await bootstrapSession()
      } catch {
        // The caller cares about the original 401/403, not about bootstrap.
        throw toApiError(error)
      }
    }

    return http.request(config as AxiosRequestConfig)
  },
)
