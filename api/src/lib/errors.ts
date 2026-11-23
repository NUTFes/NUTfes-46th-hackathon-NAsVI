import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ProblemCode =
  | 'invalid_input' | 'unauthorized' | 'not_found' | 'label_not_found'
  | 'label_title_taken' | 'label_in_use' | 'landmark_in_use' | 'out_of_venue'
  | 'not_stamp_owner' | 'too_many_requests' | 'payload_too_large'
  | 'footprint_unavailable' | 'internal_error';

export function problem(c: Context, status: ContentfulStatusCode, code: ProblemCode, message: string, field?: string): Response {
  return c.newResponse(JSON.stringify({ code, message, ...(status === 400 && field !== undefined ? { field } : {}) }), status, {
    'Content-Type': 'application/problem+json',
  });
}
