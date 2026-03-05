import { findProjectRoot, scanFiles } from '../indexer/scanner.js';
import { loadConfig } from '../config/loader.js';

export async function handleGetFileTree(args: Record<string, unknown>) {
  const path = args.path as string | undefined;
  const projectRoot = path ?? findProjectRoot(process.cwd());
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

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        project: projectRoot,
        total_files: files.length,
        code_files: codeFiles.length,
        doc_files: docFiles.length,
        languages: [...extensions].sort(),
        tree,
      }, null, 2),
    }],
  };
}
