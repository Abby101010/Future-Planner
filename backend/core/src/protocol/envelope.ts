export const PROTOCOL_VERSION = 1 as const;

export interface Envelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  ok: boolean;
  kind: string;
  data?: T;
  error?: { code: string; message: string };
  ts: string;
  streamId?: string;
  /** Optional correlation ID — set by the server when responding to a
   *  request that carried `X-Correlation-Id`, or when broadcasting events
   *  that originated from such a request. Used by the dev-log to tie
   *  user-initiated actions to their downstream WS effects. */
  correlationId?: string;
}

export interface QueryRequest<A = unknown> {
  v: typeof PROTOCOL_VERSION;
  kind: string;
  args?: A;
}

export interface CommandRequest<A = unknown> {
  v: typeof PROTOCOL_VERSION;
  kind: string;
  args: A;
}

export function envelope<T>(
  kind: string,
  data: T,
  streamId?: string,
  correlationId?: string,
): Envelope<T> {
  return {
    v: PROTOCOL_VERSION,
    ok: true,
    kind,
    data,
    ts: new Date().toISOString(),
    ...(streamId ? { streamId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

export function envelopeError(
  kind: string,
  code: string,
  message: string,
  streamId?: string,
  correlationId?: string,
): Envelope<never> {
  return {
    v: PROTOCOL_VERSION,
    ok: false,
    kind,
    error: { code, message },
    ts: new Date().toISOString(),
    ...(streamId ? { streamId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}
