/** Test-only Axios adapter with request recording. */

import { AxiosError } from 'axios'
import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'

export type MockHandler = (
  config: InternalAxiosRequestConfig,
) => AxiosResponse | Promise<AxiosResponse>

export interface MockAdapter {
  adapter: AxiosAdapter
  requests: InternalAxiosRequestConfig[]
}

export function createMockAdapter(handler: MockHandler): MockAdapter {
  const requests: InternalAxiosRequestConfig[] = []

  const adapter: AxiosAdapter = async (config) => {
    const request = config as InternalAxiosRequestConfig
    requests.push(request)
    return handler(request)
  }

  return { adapter, requests }
}

export function makeResponse<T>(
  config: InternalAxiosRequestConfig,
  status: number,
  data: T,
): AxiosResponse<T> {
  return { data, status, statusText: '', headers: {}, config }
}

export function makeError(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    undefined,
    makeResponse(config, status, data),
  )
}

export function networkError(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', config)
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

/** Path without the query string, e.g. `/tasks` or `/session`. */
export function pathOf(config: InternalAxiosRequestConfig): string {
  return (config.url ?? '').split('?')[0]
}

export function csrfHeaderOf(
  config: InternalAxiosRequestConfig | undefined,
): string | null | undefined {
  const value = config?.headers.get('X-CSRF-Token')
  if (value === undefined || value === null) {
    return value
  }
  return Array.isArray(value) ? value.join(',') : String(value)
}

/** Parse the JSON body exactly as it went over the wire. */
export function bodyOf(config: InternalAxiosRequestConfig): unknown {
  if (typeof config.data !== 'string') {
    return config.data
  }
  return JSON.parse(config.data) as unknown
}
