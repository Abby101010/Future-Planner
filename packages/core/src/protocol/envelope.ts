export const PROTOCOL_VERSION = 1 as const;

export interface Envelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  ok: boolean;
  kind: string;
  data?: T;
  error?: { code: string; message: string };
  ts: string;
  streamId?: string;
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

export function envelope<T>(kind: string, data: T, streamId?: string): Envelope<T> {
  return { v: PROTOCOL_VERSION, ok: true, kind, data, ts: new Date().toISOString(), ...(streamId ? { streamId } : {}) };
}

export function envelopeError(kind: string, code: string, message: string, streamId?: string): Envelope<never> {
  return { v: PROTOCOL_VERSION, ok: false, kind, error: { code, message }, ts: new Date().toISOString(), ...(streamId ? { streamId } : {}) };
}
