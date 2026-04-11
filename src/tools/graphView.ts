/**
 * Tool: graph_view
 * Launches a local HTTP server serving the 3D dependency graph dashboard.
 * Routes: / (HTML), /api/data (graph JSON), /api/file-outline?file=... (outline JSON)
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { URL } from 'node:url';
import { getGraphDashboardHtml } from '../graph/graphDashboard.js';
import { buildGraphData } from '../graph/export.js';
import { parseFileSymbolsAndContext } from '../indexer/chunker.js';
import { findProjectRoot } from '../indexer/scanner.js';

let httpServer: Server | null = null;
let activePort: number | null = null;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = createNetServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return start;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
}

function makeRequestHandler(projectRoot: string, port: number) {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const rawUrl = req.url ?? '/';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, `http://localhost:${port}`);
    } catch {
      res.writeHead(400); res.end('Bad Request'); return;
    }
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/data') {
      buildGraphData(projectRoot)
        .then(data => {
          setCorsHeaders(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
      return;
    }

    if (pathname === '/api/file-source') {
      const filePath = parsedUrl.searchParams.get('file') ?? '';
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing file parameter' }));
        return;
      }
      readFile(filePath, 'utf-8')
        .then(content => {
          setCorsHeaders(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ file: filePath, content }));
        })
        .catch(() => {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found', content: '' }));
        });
      return;
    }

    if (pathname === '/api/file-outline') {
      const filePath = parsedUrl.searchParams.get('file') ?? '';
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing file parameter' }));
        return;
      }
      readFile(filePath, 'utf-8')
        .then(content => {
          const ext = extname(filePath).toLowerCase();
          const { symbols } = parseFileSymbolsAndContext(content, filePath, ext);
          setCorsHeaders(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            file: filePath,
            symbols: symbols.map(s => ({ name: s.name, kind: s.kind, lines: `${s.line_start}-${s.line_end}` })),
          }));
        })
        .catch(() => {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found', symbols: [] }));
        });
      return;
    }

    // Serve dashboard HTML for all other routes
    const apiBase = `http://localhost:${port}`;
    const html = getGraphDashboardHtml(apiBase);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(html);
  };
}

export async function handleGraphView(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const requestedPort = typeof args.port === 'number' ? args.port : 8091;
  const projectRoot = findProjectRoot(process.cwd());

  // Reuse existing server if already running
  if (httpServer && activePort) {
    const url = `http://localhost:${activePort}`;
    return {
      content: [{
        type: 'text',
        text: `Graph View déjà actif sur ${url}\n\nPour l'ouvrir dans VS Code (Simple Browser) :\n\`code --open-url "${url}"\``,
      }],
    };
  }

  const port = await findAvailablePort(requestedPort);
  activePort = port;

  httpServer = createServer(makeRequestHandler(projectRoot, port));

  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject);
    httpServer!.listen(port, '127.0.0.1', resolve);
  });

  const url = `http://localhost:${port}`;
  return {
    content: [{
      type: 'text',
      text: `Graph 3D disponible sur ${url}\n\nPour l'ouvrir dans VS Code (Simple Browser) :\n\`code --open-url "${url}"\`\n\nNœuds colorés par langage. Clic sur un nœud pour voir le détail du fichier.\n💡 Next steps:\n  • Utilisez le champ "Search file" pour zoomer sur un sous-graphe\n  • Toggles en sidebar pour masquer node_modules ou filtrer par type de fichier`,
    }],
  };
}

/** Stop the graph server (called on MCP shutdown). */
export function stopGraphServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    activePort = null;
  }
}
