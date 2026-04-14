/**
 * Tool: usage_breakdown
 * Returns a structured Markdown report showing where tokens go:
 *   1. Task category breakdown (coding, debugging, feature, etc.)
 *   2. MCP server breakdown (which servers are called most)
 *   3. Core tool breakdown (Read, Edit, Bash, Grep, etc.)
 *
 * Inspired by Codeburn (AgentSeal/codeburn) — "see where your AI coding tokens go".
 * No API key required. Reads from ~/.claude/usage.db (local SQLite).
 */

import { queryCategoryBreakdown, queryMcpBreakdown, queryCoreToolBreakdown, queryTotals, type StatsQuery } from '../usage/store.js';
import { formatTokens } from '../usage/pricing.js';
import { scanUsage } from '../usage/scanner.js';
import { CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_COLORS, type TaskCategory } from '../usage/classifier.js';

const PERIOD_LABELS: Record<string, string> = {
  today: "aujourd'hui",
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  all: 'depuis le début',
};

export async function handleUsageBreakdown(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const period = (args.period as StatsQuery['period']) ?? 'all';
  const periodLabel = PERIOD_LABELS[period] ?? period;

  await scanUsage();

  const [totals, categories, mcpRows, coreToolRows] = await Promise.all([
    queryTotals(period),
    queryCategoryBreakdown(period),
    queryMcpBreakdown(period),
    queryCoreToolBreakdown(period),
  ]);

  const lines: string[] = [];
  lines.push(`## Où partent tes tokens ? — ${periodLabel}`);
  lines.push('');

  if (totals.turns === 0) {
    lines.push('Aucune donnée d\'utilisation trouvée pour cette période.');
    lines.push('');
    lines.push('Lance une session Claude Code, puis rappelle cet outil.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  const totalTokens = totals.input + totals.output + totals.cache_read + totals.cache_creation;
  lines.push(`**${totals.turns} turns · ${formatTokens(totalTokens)} tokens · ${totals.sessions} sessions**`);
  lines.push('');

  // ── Section 1 : Task categories ───────────────────────────────────────────
  lines.push('### 📊 Par type de tâche');
  lines.push('');

  if (!categories.length) {
    lines.push('*Aucune catégorie détectée. Les nouvelles sessions seront classifiées automatiquement.*');
  } else {
    const totalCatTurns = categories.reduce((s, r) => s + r.turn_count, 0);
    const totalCatTokens = categories.reduce((s, r) => s + r.total_input + r.total_output, 0);

    lines.push('| Catégorie | Turns | % | Tokens |');
    lines.push('|-----------|-------|---|--------|');

    for (const r of categories) {
      const cat = r.category as TaskCategory;
      const icon = CATEGORY_ICONS[cat] ?? '📌';
      const label = CATEGORY_LABELS[cat] ?? r.category;
      const pctTurns = totalCatTurns > 0 ? ((r.turn_count / totalCatTurns) * 100).toFixed(0) : '0';
      const tokens = r.total_input + r.total_output;
      const bar = buildBar(r.turn_count, totalCatTurns, 12);
      lines.push(`| ${icon} **${label}** | ${r.turn_count} | ${bar} ${pctTurns}% | ${formatTokens(tokens)} |`);
    }

    lines.push('');
    lines.push(`> Classifié sur **${totalCatTurns}** turns visibles`);
  }

  lines.push('');

  // ── Section 2 : MCP servers ────────────────────────────────────────────────
  lines.push('### 🔌 Par serveur MCP');
  lines.push('');

  if (!mcpRows.length) {
    lines.push('*Aucun appel MCP détecté dans cette période.*');
    lines.push('> Les outils MCP ont un préfixe `mcp__`. Ex: `mcp__stellaris-code-search__search_code`');
  } else {
    const totalMcpCalls = mcpRows.reduce((s, r) => s + r.call_count, 0);

    lines.push('| Serveur | Appels | % | Turns |');
    lines.push('|---------|--------|---|-------|');

    for (const r of mcpRows.slice(0, 15)) {
      const pct = totalMcpCalls > 0 ? ((r.call_count / totalMcpCalls) * 100).toFixed(0) : '0';
      const bar = buildBar(r.call_count, totalMcpCalls, 12);
      lines.push(`| \`${r.server}\` | ${r.call_count} | ${bar} ${pct}% | ${r.turn_count} |`);
    }

    lines.push('');
    lines.push(`> **${totalMcpCalls}** appels MCP au total`);
  }

  lines.push('');

  // ── Section 3 : Core tools ────────────────────────────────────────────────
  lines.push('### 🔧 Outils Claude (top 15)');
  lines.push('');

  if (!coreToolRows.length) {
    lines.push('*Aucune donnée de core tools. Un re-scan complet est peut-être nécessaire.*');
  } else {
    const totalCoreToolCalls = coreToolRows.reduce((s, r) => s + r.call_count, 0);
    const top15 = coreToolRows.slice(0, 15);

    lines.push('| Outil | Appels | % |');
    lines.push('|-------|--------|---|');

    for (const r of top15) {
      const pct = totalCoreToolCalls > 0 ? ((r.call_count / totalCoreToolCalls) * 100).toFixed(0) : '0';
      const bar = buildBar(r.call_count, totalCoreToolCalls, 12);
      lines.push(`| \`${r.tool}\` | ${r.call_count} | ${bar} ${pct}% |`);
    }

    lines.push('');
    lines.push(`> **${totalCoreToolCalls}** appels d'outils au total (top 15 affichés)`);
  }

  lines.push('');
  lines.push('---');
  lines.push('> *Pour visualiser dans le dashboard avec graphiques : `usage_dashboard` → onglet **Breakdown***');
  lines.push('> *Pour zoomer sur une période : `period="7d"` ou `period="30d"`*');

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/** Build a mini ASCII bar proportional to value/total, maxWidth chars wide. */
function buildBar(value: number, total: number, maxWidth: number): string {
  if (total === 0) return '░'.repeat(maxWidth);
  const filled = Math.round((value / total) * maxWidth);
  return '█'.repeat(filled) + '░'.repeat(maxWidth - filled);
}
