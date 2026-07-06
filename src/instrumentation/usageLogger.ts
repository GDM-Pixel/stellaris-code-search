/**
 * Tool usage instrumentation — measures the real token cost of Stellaris tools
 * to guide token-efficiency decisions on data, not intuition.
 *
 * Writes one JSONL line per tool call to .vectors/tool-usage.jsonl.
 * Disable with STELLARIS_USAGE_LOG=false.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MAX_STRING_LEN = 30;

function isDisabled(): boolean {
  const raw = process.env.STELLARIS_USAGE_LOG;
  if (!raw) return false;
  return raw.toLowerCase() === 'false' || raw === '0';
}

function logPath(projectRoot: string): string {
  return join(projectRoot, '.vectors', 'tool-usage.jsonl');
}

function sanitizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    return v.length > MAX_STRING_LEN ? v.slice(0, MAX_STRING_LEN) + '…' : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    return { _type: 'array', length: v.length };
  }
  if (typeof v === 'object') {
    return { _type: 'object', keys: Object.keys(v as object).length };
  }
  return typeof v;
}

function sanitizeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = sanitizeValue(v);
  }
  return out;
}

function resultBytes(result: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(result), 'utf8');
  } catch {
    return 0;
  }
}

export interface UsageRecord {
  ts: string;
  tool: string;
  bytes: number;
  durationMs: number;
  args: Record<string, unknown>;
  ok: boolean;
  errorKind?: string;
}

export function logToolCall(
  projectRoot: string,
  record: UsageRecord,
): void {
  if (isDisabled()) return;

  const path = logPath(projectRoot);
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
  } catch (err: any) {
    // Never break the tool call on a logging failure.
    console.error('[Stellaris usage] log write failed:', err.message);
  }
}

/**
 * Wraps a tool handler call with instrumentation.
 * Captures bytes-out, duration, and sanitized args. Always re-throws on error
 * so the MCP dispatch path is unaffected.
 */
export async function instrumentToolCall<T>(
  projectRoot: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const ts = new Date(startedAt).toISOString();
  let result: T | undefined;
  let ok = true;
  let errorKind: string | undefined;

  try {
    result = await fn();
    return result;
  } catch (err: any) {
    ok = false;
    errorKind = err?.constructor?.name ?? 'Error';
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    logToolCall(projectRoot, {
      ts,
      tool: toolName,
      bytes: result ? resultBytes(result) : 0,
      durationMs,
      args: sanitizeArgs(args),
      ok,
      errorKind,
    });
  }
}
