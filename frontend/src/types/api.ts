/**
 * Transport-level contracts shared by the API layer.
 *
 * Dates stay ISO 8601 strings: parsing/formatting belongs to the UI layer.
 */

export interface SessionResponse {
  id: string
  csrf_token: string
  expires_at: string
  is_new: boolean
}

/** One entry of FastAPI's 422 `detail` array. */
export interface ApiValidationIssue {
  type: string
  loc: Array<string | number>
  msg: string
  input?: unknown
  ctx?: Record<string, unknown>
}

/** Body shape used by FastAPI errors: `{"detail": "..."}` or `{"detail": [...]}`. */
export interface ApiErrorPayload {
  detail?: string | ApiValidationIssue[]
}
