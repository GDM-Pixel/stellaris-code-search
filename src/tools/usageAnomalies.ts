/**
 * Tool: usage_anomalies
 * Surfaces Claude Code sessions that hit health thresholds (inspired by Claudoscope SES001-SES004).
 *
 * Rules:
 *   SES001 — estimated API cost >= $25
 *   SES002 — visible turn count >= 200
 *   SES003 — cumulative tokens (input + output + cache) >= 5M
 *   SES004 — idle 7+ days with 50+ turns
 *
 * No API key required. Reads from ~/.claude/usage.db (local SQLite).
 */

import { querySessionAnomalies, type AnomalyRule, type StatsQuery } from '../usage/store.js';
import { formatTokens } from '../usage/pricing.js';
import { scanUsage } from '../usage/scanner.js';

const RULE_DESCRIPTIONS: Record<AnomalyRule, string> = {
  SES001: 'Coût estimé ≥ $25 (valeur API Anthropic)',
  SES002: 'Conversation longue ≥ 200 turns visibles',
  SES003: 'Volume élevé ≥ 5M tokens cumulés (incl. cache)',
  SES004: 'Session idle 7+ jours avec 50+ turns',
};

const RULE_ICONS: Record<AnomalyRule, string> = {
  SES001: '💸',
  SES002: '💬',
  SES003: '📦',
  SES004: '💤',
};

export async function handleUsageAnomalies(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const period = (args.period as StatsQuery['period']) ?? 'all';

  await scanUsage();
  const anomalies = await querySessionAnomalies(period);

  const lines: string[] = [];
  lines.push('## Session Health — Anomalies détectées');
  lines.push('');

  if (!anomalies.length) {
    lines.push('✅ **Aucune session anormale** dans la période sélectionnée.');
    lines.push('');
    lines.push('Toutes tes sessions respectent les seuils normaux :');
    for (const [rule, desc] of Object.entries(RULE_DESCRIPTIONS) as [AnomalyRule, string][]) {
      lines.push(`- ${RULE_ICONS[rule]} **${rule}** — ${desc}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // Group by rule for summary
  const byRule = new Map<AnomalyRule, number>();
  for (const a of anomalies) {
    byRule.set(a.rule, (byRule.get(a.rule) ?? 0) + 1);
  }

  lines.push(`**${anomalies.length} session(s) anormale(s) détectée(s) :**`);
  lines.push('');
  for (const [rule, count] of byRule) {
    lines.push(`- ${RULE_ICONS[rule]} **${rule}** (${count}x) — ${RULE_DESCRIPTIONS[rule]}`);
  }
  lines.push('');

  // Detailed table
  lines.push('| Règle | Session | Projet | Modèle | Turns | Tokens totaux | Dernière activité | Détail |');
  lines.push('|-------|---------|--------|--------|-------|---------------|-------------------|--------|');

  for (const a of anomalies) {
    const totalTokens = a.total_input_tokens + a.total_output_tokens + a.total_cache_read + a.total_cache_creation;
    const lastTs = (a.last_timestamp ?? '').replace('T', ' ').substring(0, 16);
    const icon = RULE_ICONS[a.rule];
    lines.push(
      `| ${icon} ${a.rule} | \`${(a.session_id ?? '').substring(0, 8)}\` | ${a.project_name || '—'} | ${a.model || '—'} | ${a.turn_count} | ${formatTokens(totalTokens)} | ${lastTs || '—'} | ${a.detail} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('> **Seuils** : SES001 coût API ≥ $25 · SES002 ≥ 200 turns · SES003 ≥ 5M tokens · SES004 idle 7j+ / 50+ turns');
  lines.push('> *Pour visualiser dans le dashboard : `usage_dashboard` → onglet Anomalies*');

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
