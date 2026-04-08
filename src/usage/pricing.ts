/**
 * Claude Code Usage Tracking — Pricing module
 * API prices per 1M tokens (April 2026)
 *
 * NOTE: Cache tokens (read + creation) are included in Pro/Max subscriptions.
 * The "useful cost" (input + output only) is the most meaningful metric for
 * subscribers. The "full API cost" (with cache) is shown as secondary info.
 *
 * Pricing sources (Anthropic docs, April 2026):
 * - Claude Opus 4.6 / 4.5: $5 input, $25 output, $0.50 cache read, $6.25 cache write
 * - Claude Opus 4.1 (legacy): $15 input, $75 output, $1.50 cache read, $18.75 cache write
 * - Claude Sonnet 4.6: $3 input, $15 output, $0.30 cache read, $3.75 cache write
 * - Claude Haiku 4.5: $1 input, $5 output, $0.10 cache read, $1.25 cache write
 * - Claude Haiku 3.5 (legacy): $0.80 input, $4 output, $0.08 cache read, $1.00 cache write
 */

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Keyed by tier name — match order matters in getPricingTier()
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.x (4-6, 4-5) — $5/$25
  'opus-4-6': { input: 5.00,  output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  'opus-4-5': { input: 5.00,  output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  // Opus 4-1 legacy — $15/$75
  'opus-4-1': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  // Opus fallback (any other opus = assume 4.x pricing)
  'opus':     { input: 5.00,  output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  // Sonnet
  'sonnet':   { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  // Haiku 4.x
  'haiku-4':  { input: 1.00,  output: 5.00,  cacheRead: 0.10, cacheWrite: 1.25 },
  // Haiku 3.x legacy
  'haiku-3':  { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },
  // Haiku fallback = 4.x
  'haiku':    { input: 1.00,  output: 5.00,  cacheRead: 0.10, cacheWrite: 1.25 },
};

export function getPricingTier(model: string): keyof typeof MODEL_PRICING | null {
  const m = model.toLowerCase();
  // Check specific versions first (order matters)
  if (m.includes('opus')) {
    if (m.includes('4-1')) return 'opus-4-1';
    if (m.includes('4-5')) return 'opus-4-5';
    if (m.includes('4-6')) return 'opus-4-6';
    return 'opus'; // fallback = modern opus pricing
  }
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) {
    if (m.includes('-3')) return 'haiku-3';
    return 'haiku-4'; // haiku 4.x by default
  }
  return null;
}

/** Cost without cache — most relevant for Pro/Max subscribers. */
export function calculateUsefulCost(model: string, tokens: Pick<TokenCounts, 'input' | 'output'>): number {
  const tier = getPricingTier(model);
  if (!tier) return 0;
  const p = MODEL_PRICING[tier];
  return (tokens.input * p.input + tokens.output * p.output) / 1_000_000;
}

/** Full API cost including cache — for "what if I used the API?" curiosity. */
export function calculateFullApiCost(model: string, tokens: TokenCounts): number {
  const tier = getPricingTier(model);
  if (!tier) return 0;
  const p = MODEL_PRICING[tier];
  return (
    tokens.input * p.input +
    tokens.output * p.output +
    tokens.cacheRead * p.cacheRead +
    tokens.cacheCreation * p.cacheWrite
  ) / 1_000_000;
}

/** @deprecated Use calculateUsefulCost or calculateFullApiCost instead. */
export function calculateCost(model: string, tokens: TokenCounts): number {
  return calculateUsefulCost(model, tokens);
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}
