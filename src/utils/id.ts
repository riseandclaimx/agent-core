import { ulid } from "ulid";
import { randomBytes } from "node:crypto";

/** Generate a ULID (time-sortable, 26 chars) */
export function generateId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}

/** Generate a secure random token */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generate a trace ID for request tracing */
export function generateTraceId(): string {
  return `tr_${ulid()}`;
}

/** Generate a span ID */
export function generateSpanId(): string {
  return `sp_${ulid().slice(-16)}`;
}