/**
 * Tool: usage_stats
 * Shows Claude Code consumption with full API equivalent cost (including cache)
 * so subscribers can measure their ROI vs their Max/Pro subscription price.
 */

import { queryStats, queryTotals, type StatsQuery } from '../usage/store.js';
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

export async function handleUsageStats(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const period = (args.period as StatsQuery['period']) ?? 'today';
  const groupBy = (args.group_by as StatsQuery['groupBy']) ?? 'model';

  await scanUsage();

  const totals = await queryTotals(period);
  const rows = await queryStats({ period, groupBy });

  if (totals.turns === 0) {
    return {
      content: [{
        type: 'text',
        text: `Aucune donnée d'utilisation pour ${PERIOD_LABELS[period] ?? period}.\n\nAssure-toi d'avoir lancé au moins une session Claude Code.`,
      }],
    };
  }

  const lines: string[] = [];
  const periodLabel = PERIOD_LABELS[period] ?? period;

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
