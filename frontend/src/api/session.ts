import { bootstrapSession } from './client'
import type { SessionResponse } from '@/types/api'

/**
 * Public session entry point for stores and the app bootstrap.
 *
 * Delegates to the single-flight client bootstrap, so an explicit call and a
 * concurrent 401 recovery share the same `GET /session`.
 */
export function getSession(): Promise<SessionResponse> {
  return bootstrapSession()
}
