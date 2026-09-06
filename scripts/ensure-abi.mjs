#!/usr/bin/env node
/**
 * better-sqlite3 must match nova-node (Node 22, ABI 127).
 * `npm rebuild` against PATH node (mise 26 = ABI 147) breaks Grok's MCP.
 */
const ABI = process.versions.modules;
const NEED = "127";
if (ABI === NEED) {
  process.exit(0);
}
console.warn(
  `[stellaris] skip native rebuild: need Node 22 (ABI ${NEED}), got ${process.version} ABI ${ABI}.\n` +
    `  Install/rebuild with nova-node, e.g.\n` +
    `  /home/charles/.local/bin/nova-node $(command -v npm) install\n` +
    `  or: mise trust && mise install  (this repo pins node 22)`,
);
process.exit(0);
