/**
 * Tool: usage_stats
 * Shows Claude Code consumption with full API equivalent cost (including cache)
 * so subscribers can measure their ROI vs their Max/Pro subscription price.
 */

import { queryStats, queryTotals, queryCacheStats, queryWhatIfTokens, querySessionAnomalies, queryCategoryBreakdown, queryMcpBreakdown, queryCoreToolBreakdown, type StatsQuery } from '../usage/store.js';
import { calculateUsefulCost, calculateFullApiCost, formatCost, formatTokens, getPricingTier } from '../usage/pricing.js';
import { scanUsage } from '../usage/scanner.js';

const PERIOD_LABELS: Record<string, string> = {
  today: "aujourd'hui",
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  all: 'depuis le début',
};

// Claude Max subscription price (monthly). Used to compute savings.
const MAX_PRICE_MONTHLY = 100;

type ExtendedGroupBy = StatsQuery['groupBy'] | 'cache' | 'anomaly' | 'category' | 'mcp' | 'core_tool';

export async function handleUsageStats(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const period = (args.period as StatsQuery['period']) ?? 'today';
  const groupBy = (args.group_by as ExtendedGroupBy) ?? 'model';

  await scanUsage();

  const periodLabel = PERIOD_LABELS[period] ?? period;

  // ── group_by: cache ───────────────────────────────────────────────────────
  if (groupBy === 'cache') {
    const cacheRows = await queryCacheStats(period);
    if (!cacheRows.length) {
      return { content: [{ type: 'text', text: `Aucune donnée de cache pour ${periodLabel}.` }] };
    }
    const lines: string[] = [];
    lines.push(`## Cache Analytics — ${periodLabel}`);
    lines.push('');
    lines.push('| Modèle | Input | Cache Read | Cache Write | Hit Ratio | Gain est. |');
    lines.push('|--------|-------|-----------|------------|-----------|-----------|');
    for (const r of cacheRows) {
      const hitPct = (r.hit_ratio * 100).toFixed(1) + '%';
      // Approximate savings: cache_read tokens cost ~10% of input tokens at Sonnet rate
      // Real savings = cache_read × (input_rate - cache_read_rate) / 1M
      // Shown qualitatively rather than as a dollar amount here (no model-aware rate here)
      const efficiencyLabel = r.hit_ratio >= 0.7 ? '🟢 Excellent' : r.hit_ratio >= 0.4 ? '🟡 Moyen' : '🔴 Faible';
      lines.push(`| ${r.model} | ${formatTokens(r.total_input)} | ${formatTokens(r.total_cache_read)} | ${formatTokens(r.total_cache_creation)} | ${hitPct} | ${efficiencyLabel} |`);
    }
    lines.push('');
    lines.push('> **Hit Ratio** = tokens servis depuis le cache / (input + cache read). Plus c\'est haut, mieux tes prompts exploitent le cache Anthropic (TTL 5min ou 1h).');
    lines.push('> 🟢 ≥ 70% · 🟡 40-70% · 🔴 < 40%');

    // What-if: show Opus→Sonnet savings if any Opus tokens in period
    const opusTokens = await queryWhatIfTokens(period, 'opus');
    if (opusTokens && opusTokens.turns > 0) {
      const opusCost = calculateFullApiCost('claude-opus-4-6', {
        input: opusTokens.input, output: opusTokens.output,
        cacheRead: opusTokens.cache_read, cacheCreation: opusTokens.cache_creation,
      });
      const sonnetCost = calculateFullApiCost('claude-sonnet-4-6', {
        input: opusTokens.input, output: opusTokens.output,
        cacheRead: opusTokens.cache_read, cacheCreation: opusTokens.cache_creation,
      });
      const savings = opusCost - sonnetCost;
      if (savings > 0) {
        lines.push('');
        lines.push(`### 💡 What-if : Opus → Sonnet`);
        lines.push(`Si tes ${opusTokens.turns} turns Opus avaient tourné en Sonnet :`);
        lines.push(`- Coût Opus actuel : **${formatCost(opusCost)}**`);
        lines.push(`- Coût Sonnet hypothétique : **${formatCost(sonnetCost)}**`);
        lines.push(`- Économie potentielle : **${formatCost(savings)}**`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── group_by: anomaly ─────────────────────────────────────────────────────
  if (groupBy === 'anomaly') {
    const anomalies = await querySessionAnomalies(period);
    const lines: string[] = [];
    lines.push(`## Session Health — ${periodLabel}`);
    lines.push('');
    if (!anomalies.length) {
      lines.push('✅ Aucune session problématique détectée. Toutes tes sessions sont dans les seuils normaux.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    const RULE_LABELS: Record<string, string> = {
      SES001: '💸 Coût élevé (≥$25)',
      SES002: '💬 Trop de messages (≥200)',
      SES003: '📦 Trop de tokens (≥5M)',
      SES004: '💤 Session idle (7j+, 50+ turns)',
    };
    lines.push(`**${anomalies.length} session(s) anormale(s) détectée(s) :**`);
    lines.push('');
    lines.push('| Règle | Session | Projet | Modèle | Turns | Détail |');
    lines.push('|-------|---------|--------|--------|-------|--------|');
    for (const a of anomalies) {
      const ruleLabel = RULE_LABELS[a.rule] ?? a.rule;
      lines.push(`| ${ruleLabel} | \`${a.session_id.substring(0, 8)}\` | ${a.project_name || '—'} | ${a.model} | ${a.turn_count} | ${a.detail} |`);
    }
    lines.push('');
    lines.push('> **Règles** : SES001 coût API estimé ≥ $25 · SES002 ≥ 200 turns · SES003 ≥ 5M tokens · SES004 idle 7j+ avec 50+ turns');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── group_by: category ───────────────────────────────────────────────────
  if (groupBy === 'category') {
    const { CATEGORY_LABELS, CATEGORY_ICONS } = await import('../usage/classifier.js');
    const rows = await queryCategoryBreakdown(period);
    const lines: string[] = [];
    lines.push(`## Breakdown par catégorie — ${periodLabel}`);
    lines.push('');
    if (!rows.length) {
      lines.push('Aucune donnée. Lance une session Claude Code puis relance cette commande.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    const totalTurns = rows.reduce((s, r) => s + r.turn_count, 0);
    const totalTokens = rows.reduce((s, r) => s + r.total_input + r.total_output, 0);
    lines.push('| Catégorie | Turns | % turns | Tokens | % tokens |');
    lines.push('|-----------|-------|---------|--------|----------|');
    for (const r of rows) {
      const cat = r.category as keyof typeof CATEGORY_LABELS;
      const label = (CATEGORY_ICONS[cat] ?? '📌') + ' ' + (CATEGORY_LABELS[cat] ?? r.category);
      const pctTurns = totalTurns > 0 ? ((r.turn_count / totalTurns) * 100).toFixed(1) : '0';
      const tokens = r.total_input + r.total_output;
      const pctTok = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : '0';
      lines.push(`| ${label} | ${r.turn_count} | ${pctTurns}% | ${formatTokens(tokens)} | ${pctTok}% |`);
    }
    lines.push('');
    lines.push(`> **Total :** ${totalTurns} turns · ${formatTokens(totalTokens)} tokens (input + output)`);
    lines.push('> *Pour visualiser dans le dashboard : `usage_dashboard` → onglet Breakdown*');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── group_by: mcp ─────────────────────────────────────────────────────────
  if (groupBy === 'mcp') {
    const rows = await queryMcpBreakdown(period);
    const lines: string[] = [];
    lines.push(`## Breakdown par serveur MCP — ${periodLabel}`);
    lines.push('');
    if (!rows.length) {
      lines.push('Aucun appel MCP détecté dans cette période.');
      lines.push('');
      lines.push('> Les appels MCP sont détectés par le préfixe `mcp__` dans les noms de tools. Ils nécessitent un re-scan de tes sessions.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    const totalCalls = rows.reduce((s, r) => s + r.call_count, 0);
    lines.push('| Serveur MCP | Appels | % appels | Turns impliqués |');
    lines.push('|-------------|--------|---------|-----------------|');
    for (const r of rows) {
      const pct = totalCalls > 0 ? ((r.call_count / totalCalls) * 100).toFixed(1) : '0';
      lines.push(`| \`${r.server}\` | ${r.call_count} | ${pct}% | ${r.turn_count} |`);
    }
    lines.push('');
    lines.push(`> **Total :** ${totalCalls} appels MCP`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── group_by: core_tool ───────────────────────────────────────────────────
  if (groupBy === 'core_tool') {
    const rows = await queryCoreToolBreakdown(period);
    const lines: string[] = [];
    lines.push(`## Breakdown par outil Claude — ${periodLabel}`);
    lines.push('');
    if (!rows.length) {
      lines.push('Aucune donnée de tools dans cette période. Un re-scan est peut-être nécessaire.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    const totalCalls = rows.reduce((s, r) => s + r.call_count, 0);
    lines.push('| Outil | Appels | % appels |');
    lines.push('|-------|--------|---------|');
    for (const r of rows.slice(0, 20)) {
      const pct = totalCalls > 0 ? ((r.call_count / totalCalls) * 100).toFixed(1) : '0';
      lines.push(`| \`${r.tool}\` | ${r.call_count} | ${pct}% |`);
    }
    lines.push('');
    lines.push(`> **Total :** ${totalCalls} appels d'outils`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // ── standard group_by: model / project / day ──────────────────────────────
  const totals = await queryTotals(period);
  const rows = await queryStats({ period, groupBy: groupBy as StatsQuery['groupBy'] });

  if (totals.turns === 0) {
    return {
      content: [{
        type: 'text',
        text: `Aucune donnée d'utilisation pour ${periodLabel}.\n\nAssure-toi d'avoir lancé au moins une session Claude Code.`,
      }],
    };
  }

  const lines: string[] = [];

  lines.push(`## Consommation Claude Code — ${periodLabel}`);
  lines.push('');
  lines.push(`**Sessions :** ${totals.sessions} | **Turns :** ${totals.turns}`);
  lines.push(`**Tokens :** ${formatTokens(totals.input)} input · ${formatTokens(totals.output)} output · ${formatTokens(totals.cache_read)} cache read · ${formatTokens(totals.cache_creation)} cache write`);
  lines.push('');

  if (groupBy === 'model') {
    lines.push('### Par modèle');
    lines.push('');

    let grandFull = 0;
    let grandUseful = 0;
    const tableRows: string[] = [];

    for (const row of rows) {
      const model = row.group_key || 'unknown';
      const tier = getPricingTier(model);
      const fullCost = calculateFullApiCost(model, {
        input: row.input, output: row.output,
        cacheRead: row.cache_read, cacheCreation: row.cache_creation,
      });
      const usefulCost = calculateUsefulCost(model, { input: row.input, output: row.output });
      grandFull += fullCost;
      grandUseful += usefulCost;

      tableRows.push(
        `| ${model} | ${formatTokens(row.input)} | ${formatTokens(row.output)} | ${formatTokens(row.cache_read)} | ${row.turns} | ${tier ? formatCost(fullCost) : 'n/a'} | ${tier ? formatCost(usefulCost) : 'n/a'} |`
      );
    }

    lines.push('| Modèle | Input | Output | Cache read | Turns | Valeur API | Sans cache |');
    lines.push('|--------|-------|--------|-----------|-------|-----------|-----------|');
    lines.push(...tableRows);
    lines.push('');
    lines.push(`**Valeur API totale (avec cache) : ${formatCost(grandFull)}** ← ce qu'Anthropic absorbe pour toi`);
    lines.push(`**Équiv. sans cache : ${formatCost(grandUseful)}** ← tokens utiles seulement`);

    // ROI hint for monthly periods
    if (period === '30d' || period === 'all') {
      const savings = grandFull - MAX_PRICE_MONTHLY;
      if (savings > 0) {
        lines.push(`**Économies vs abonnement Max ($${MAX_PRICE_MONTHLY}/mois) : ${formatCost(savings)}** ✓`);
      }
    } else if (period === 'today') {
      // Extrapolate monthly
      const monthly = grandFull * 30;
      lines.push(`*Extrapolé sur 30 jours : ~${formatCost(monthly)} de valeur API*`);
    } else if (period === '7d') {
      const monthly = (grandFull / 7) * 30;
      lines.push(`*Extrapolé sur 30 jours : ~${formatCost(monthly)} de valeur API*`);
    }

    lines.push('');
    lines.push('> *Valeur API = coût si tu utilisais l\'API Anthropic directement (input + output + cache). Ton abonnement Max absorbe tout ça pour un forfait fixe.*');

  } else if (groupBy === 'project') {
    lines.push('### Par projet (top 15)');
    lines.push('');
    lines.push('| Projet | Input | Output | Cache read | Turns | Valeur API |');
    lines.push('|--------|-------|--------|-----------|-------|-----------|');

    for (const row of rows.slice(0, 15)) {
      const model = row.group_key || 'unknown';
      lines.push(
        `| ${model} | ${formatTokens(row.input)} | ${formatTokens(row.output)} | ${formatTokens(row.cache_read)} | ${row.turns} | — |`
      );
    }

  } else if (groupBy === 'day') {
    lines.push('### Par jour');
    lines.push('');
    lines.push('| Date | Input | Output | Turns |');
    lines.push('|------|-------|--------|-------|');

    for (const row of rows) {
      lines.push(
        `| ${row.group_key} | ${formatTokens(row.input)} | ${formatTokens(row.output)} | ${row.turns} |`
      );
    }
  }

  lines.push('');
  lines.push('*Pour ouvrir le dashboard complet avec graphiques, appelle `usage_dashboard`.*');

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}
