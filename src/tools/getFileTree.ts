import { findProjectRoot, scanFiles } from '../indexer/scanner.js';
import { loadConfig } from '../config/loader.js';

type FileTreeResult = { content: [{ type: 'text'; text: string }] };

// Cache to avoid redundant glob scans on repeated calls within 30s
const treeCache = new Map<string, { result: FileTreeResult; ts: number }>();
const TREE_CACHE_TTL_MS = 30_000;

export async function handleGetFileTree(args: Record<string, unknown>) {
  const path = args.path as string | undefined;
  const projectRoot = path ?? findProjectRoot(process.cwd());

  const cached = treeCache.get(projectRoot);
  if (cached && Date.now() - cached.ts < TREE_CACHE_TTL_MS) {
    return cached.result;
  }

  const config = await loadConfig(projectRoot);
  const files = await scanFiles(projectRoot, config);

  // Build a tree structure
  const tree: Record<string, string[]> = {};

  for (const file of files) {
    const parts = file.relativePath.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(parts[parts.length - 1]);
  }

  // Stats
  const codeFiles = files.filter((f) => f.category === 'code');
  const docFiles = files.filter((f) => f.category === 'docs');
  const extensions = new Set(files.map((f) => f.extension));

  const result: FileTreeResult = {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        project: projectRoot,
        total_files: files.length,
        code_files: codeFiles.length,
        doc_files: docFiles.length,
        languages: [...extensions].sort(),
        tree,
      }, null, 2) + '\n\n💡 Next steps:\n  • search_code(query) — find specific functionality by natural language\n  • get_file_outline(file) — see symbols, imports, and exports of a file\n  • search_docs(query) — search documentation sections',
    }],
  };

  treeCache.set(projectRoot, { result, ts: Date.now() });
  return result;
}
