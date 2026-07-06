/**
 * Analyses .vectors/tool-usage.jsonl and prints a token-cost breakdown.
 * Run with: npm run usage-report  (optionally pass a project root path)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface UsageRow {
  ts: string;
  tool: string;
  bytes: number;
  durationMs: number;
  args: Record<string, unknown>;
  ok: boolean;
  errorKind?: string;
}

const TOKENS_PER_BYTE = 0.25;

function load(projectRoot: string): UsageRow[] {
  const path = join(projectRoot, '.vectors', 'tool-usage.jsonl');
  if (!existsSync(path)) {
    console.error(`No usage log at ${path}`);
    console.error('Make sure Stellaris ran at least one tool call with STELLARIS_USAGE_LOG != false.');
    process.exit(1);
  }
  const raw = readFileSync(path, 'utf8');
  const records: UsageRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

function fmtTokens(bytes: number): string {
  const tk = Math.round(bytes * TOKENS_PER_BYTE);
  if (tk >= 1_000_000) return (tk / 1_000_000).toFixed(2) + 'M';
  if (tk >= 1000) return (tk / 1000).toFixed(1) + 'k';
  return String(tk);
}

function pad(s: string, n: number, right = false): string {
  if (s.length >= n) return s;
  const padding = ' '.repeat(n - s.length);
  return right ? s + padding : padding + s;
}

function summarize(records: UsageRow[]) {
  if (records.length === 0) {
    console.log('No records found.');
    return;
  }

  const byTool = new Map<string, {
    count: number;
    totalBytes: number;
    maxBytes: number;
    minBytes: number;
    totalMs: number;
    errors: number;
  }>();

  let totalBytes = 0;
  let totalCalls = 0;
  let totalErrors = 0;

  for (const r of records) {
    totalBytes += r.bytes;
    totalCalls += 1;
    if (!r.ok) totalErrors += 1;
    const entry = byTool.get(r.tool) ?? {
      count: 0, totalBytes: 0, maxBytes: 0, minBytes: Infinity, totalMs: 0, errors: 0,
    };
    entry.count += 1;
    entry.totalBytes += r.bytes;
    entry.maxBytes = Math.max(entry.maxBytes, r.bytes);
    entry.minBytes = Math.min(entry.minBytes, r.bytes);
    entry.totalMs += r.durationMs;
    if (!r.ok) entry.errors += 1;
    byTool.set(r.tool, entry);
  }

  const sorted = [...byTool.entries()].sort((a, b) => b[1].totalBytes - a[1].totalBytes);

  const firstTs = records[0].ts;
  const lastTs = records[records.length - 1].ts;

  console.log('');
  console.log('=== Stellaris tool usage report ===');
  console.log(`Window:     ${firstTs}  →  ${lastTs}`);
  console.log(`Total calls: ${totalCalls}   Errors: ${totalErrors}`);
  console.log(`Total output bytes: ${totalBytes.toLocaleString()}   ≈ ${fmtTokens(totalBytes)} tokens`);
  console.log('');

  console.log(pad('Tool', 30, true) + pad('Calls', 7) + pad('Total tk', 10) + pad('Avg tk', 8) + pad('Max tk', 8) + pad('Avg ms', 8) + pad('Err', 5));
  console.log('-'.repeat(76));
  for (const [tool, e] of sorted) {
    const avgBytes = e.totalBytes / e.count;
    const avgMs = Math.round(e.totalMs / e.count);
    console.log(
      pad(tool, 30, true) +
      pad(String(e.count), 7) +
      pad(fmtTokens(e.totalBytes), 10) +
      pad(fmtTokens(avgBytes), 8) +
      pad(fmtTokens(e.maxBytes), 8) +
      pad(String(avgMs), 8) +
      pad(String(e.errors), 5),
    );
  }

  console.log('');
  console.log('=== Top 10 heaviest single calls ===');
  const heaviest = [...records].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  for (const r of heaviest) {
    const argsStr = Object.entries(r.args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    console.log(`  ${fmtTokens(r.bytes).padStart(8)} tk   ${r.tool.padEnd(30)}  ${argsStr}`);
  }

  console.log('');
  console.log('Tip: token estimates use a 4-char/token heuristic. Real values may differ ±20%.');
  console.log('Disable logging with STELLARIS_USAGE_LOG=false');
}

const projectRoot = resolve(process.argv[2] ?? process.cwd());
summarize(load(projectRoot));
