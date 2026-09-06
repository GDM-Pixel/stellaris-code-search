import { isAbsolute, resolve } from 'node:path';

/**
 * Pull the edited file path out of a Grok/Claude PostToolUse stdin payload.
 * Grok: camelCase toolInput.file_path
 * Claude: snake_case tool_input.file_path
 * Claude hook command can also pass the path as argv.
 */
export function extractEditedPath(event, argvPath) {
  if (typeof argvPath === 'string' && argvPath.length > 0 && argvPath !== '-') {
    return argvPath;
  }
  if (!event || typeof event !== 'object') return null;
  const input = event.toolInput ?? event.tool_input ?? {};
  const p = input.file_path ?? input.filePath ?? input.path ?? input.target_file;
  if (typeof p !== 'string' || !p.trim()) return null;
  return p.trim();
}

export function resolveEditedPath(rawPath, event) {
  if (!rawPath) return null;
  if (isAbsolute(rawPath)) return rawPath.replace(/\\/g, '/');
  const root = event?.workspaceRoot ?? event?.cwd ?? process.cwd();
  return resolve(root, rawPath).replace(/\\/g, '/');
}
