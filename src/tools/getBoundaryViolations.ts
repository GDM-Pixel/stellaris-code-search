/**
 * Tool: get_boundary_violations
 * Returns all architecture boundary violations detected during indexing.
 * Rules are defined in `stellaris.boundaries.json` at project root.
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { hasGraph, getAllBoundaryViolations } from '../graph/store.js';
import { loadBoundaries } from '../graph/boundaries.js';
import { truncateIfOversized } from '../utils/responseTier.js';

export async function handleGetBoundaryViolations(_args: Record<string, unknown>) {
  const projectRoot = findProjectRoot(process.cwd());

  if (!(await hasGraph(projectRoot))) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NO_GRAPH',
          message: 'No dependency graph found. Run reindex first.',
        }, null, 2),
      }],
      isError: true,
    };
  }

  const rules = await loadBoundaries(projectRoot);
  if (rules.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          summary: 'No boundary rules configured.',
          hint: 'Create stellaris.boundaries.json at project root with shape: { "deny": [{ "from": "src/ui/**", "to": "src/db/**", "reason": "..." }] }',
          rules_loaded: 0,
        }, null, 2),
      }],
    };
  }

  const violations = await getAllBoundaryViolations(projectRoot);

  // Group violations by rule for a more useful summary
  const byRule: Record<string, { rule: string; from: string; to: string; reason: string; count: number; examples: { source: string; target: string }[] }> = {};
  for (const v of violations) {
    if (!byRule[v.rule_name]) {
      byRule[v.rule_name] = {
        rule: v.rule_name,
        from: v.from_pattern,
        to: v.to_pattern,
        reason: v.reason,
        count: 0,
        examples: [],
      };
    }
    byRule[v.rule_name]!.count++;
    if (byRule[v.rule_name]!.examples.length < 5) {
      byRule[v.rule_name]!.examples.push({ source: v.source_file, target: v.target_file });
    }
  }

  const summary = violations.length === 0
    ? `No boundary violations detected (${rules.length} rule${rules.length > 1 ? 's' : ''} active).`
    : `Found ${violations.length} boundary violation(s) across ${Object.keys(byRule).length}/${rules.length} rule(s).`;

  const payload = truncateIfOversized({
    summary,
    total_violations: violations.length,
    rules_active: rules.length,
    by_rule: Object.values(byRule).sort((a, b) => b.count - a.count),
    violations,
  }, ['violations']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}
