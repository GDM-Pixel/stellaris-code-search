/**
 * Architectural layer classifier — maps a file path to a semantic layer
 * (tools, storage, graph, indexer, analytics, api, frontend, backend, security, config).
 *
 * Heuristic based on path segments (directory names + filenames), ordered by priority.
 * Configurable extensions can be added later via .stellarisrc; for now the table is fixed.
 */

export interface LayerInfo {
  layer: string;
  color: string;   // hex color for visual rendering
  badge: string;   // short label / emoji for legend
}

/** Ordered rules: first match wins. Each rule is [segment-pattern, LayerInfo]. */
const LAYER_RULES: Array<[RegExp, LayerInfo]> = [
  // Security — highest specificity first
  [/[/\\](auth|security|oauth|jwt|csrf|permission)[s]?[/\\]/i,
    { layer: 'Security', color: '#f43f5e', badge: '🔒' }],

  // Storage / Database
  [/[/\\](store|storage|db|database|repository|repositories|prisma|migrations?)[s]?[/\\]/i,
    { layer: 'Storage', color: '#8b5cf6', badge: '🗄️' }],

  // Indexer / Parser
  [/[/\\](indexer|parser|parsers|scanner|scanners|tokenizer|embeddings?)[s]?[/\\]/i,
    { layer: 'Indexer', color: '#06b6d4', badge: '🔍' }],

  // Graph / Dependency analysis
  [/[/\\](graph|dependency|dependencies|deps)[s]?[/\\]/i,
    { layer: 'Graph', color: '#a78bfa', badge: '🕸️' }],

  // Usage / Analytics
  [/[/\\](usage|analytics|metrics|stats|telemetry)[s]?[/\\]/i,
    { layer: 'Analytics', color: '#10b981', badge: '📊' }],

  // Tools / MCP handlers
  [/[/\\](tools?|handlers?|commands?)[/\\]/i,
    { layer: 'Tools', color: '#f59e0b', badge: '🔧' }],

  // API / Routes / Controllers
  [/[/\\](api|routes?|controllers?|endpoints?|middleware)[s]?[/\\]/i,
    { layer: 'API', color: '#38bdf8', badge: '🌐' }],

  // Frontend / UI
  [/[/\\](components?|ui|views?|pages?|layouts?|styles?|assets)[/\\]/i,
    { layer: 'Frontend', color: '#67e8f9', badge: '🖥️' }],

  // Services / Domain / Business logic
  [/[/\\](services?|domain|business|usecases?|use.cases?)[/\\]/i,
    { layer: 'Backend', color: '#34d399', badge: '⚙️' }],

  // Config / Environment
  [/[/\\](config|configs?|settings?|env|environments?)[/\\]/i,
    { layer: 'Config', color: '#94a3b8', badge: '⚙️' }],

  // Config files at root (e.g. vite.config.ts, tsconfig.json)
  [/\.(config|rc)\.(ts|js|mjs|cjs|json)$/i,
    { layer: 'Config', color: '#94a3b8', badge: '⚙️' }],
  [/(tsconfig|vite\.config|rollup\.config|webpack\.config|babel\.config|jest\.config)/i,
    { layer: 'Config', color: '#94a3b8', badge: '⚙️' }],
];

const FALLBACK: LayerInfo = { layer: 'Other', color: '#64748b', badge: '📄' };

/**
 * Given a file path (absolute or relative), return the semantic layer info.
 * The path is normalised to forward slashes before matching.
 */
export function classifyLayer(filePath: string): LayerInfo {
  const normalized = filePath.replace(/\\/g, '/');
  for (const [pattern, info] of LAYER_RULES) {
    if (pattern.test(normalized)) return info;
  }
  return FALLBACK;
}

/**
 * Returns the full ordered list of layers with their display properties,
 * useful for rendering a legend.
 */
export function allLayers(): LayerInfo[] {
  const seen = new Set<string>();
  const result: LayerInfo[] = [];
  for (const [, info] of LAYER_RULES) {
    if (!seen.has(info.layer)) {
      seen.add(info.layer);
      result.push(info);
    }
  }
  result.push(FALLBACK);
  return result;
}
