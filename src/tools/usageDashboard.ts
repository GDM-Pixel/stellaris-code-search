/**
 * Tool: usage_dashboard
 * Launches a local HTTP server serving the usage dashboard.
 * Returns the URL so Claude can open it in VS Code Simple Browser.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { getDashboardHtml } from '../usage/dashboard.js';
import { queryDashboardData } from '../usage/store.js';
import { scanUsage } from '../usage/scanner.js';

let httpServer: Server | null = null;
let activePort: number | null = null;

/** Check if a port is available. */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = createNetServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

/** Find the first available port starting from `start`. */
async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return start; // Fallback
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';

  if (url === '/api/data' || url.startsWith('/api/data?')) {
    queryDashboardData()
      .then(data => {
        const json = JSON.stringify(data);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(json);
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      });
    return;
  }

  // Serve dashboard for all other routes
  const port = activePort ?? 8090;
  const html = getDashboardHtml(`http://localhost:${port}`);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.end(html);
}

export async function handleUsageDashboard(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const requestedPort = typeof args.port === 'number' ? args.port : 8090;

  // If server already running on this process, reuse it
  if (httpServer && activePort) {
    // Run a fresh scan to pick up new turns
    await scanUsage();
    return {
      content: [{
        type: 'text',
        text: `Dashboard déjà actif sur http://localhost:${activePort}\n\nPour l'ouvrir dans VS Code, exécute :\n\`code --open-url "http://localhost:${activePort}"\``,
      }],
    };
  }

  // Run a fresh scan before serving
  await scanUsage();

  // Find an available port
  const port = await findAvailablePort(requestedPort);
  activePort = port;

  // Start HTTP server
  httpServer = createServer(handleRequest);

  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject);
    httpServer!.listen(port, '127.0.0.1', resolve);
  });

  const url = `http://localhost:${port}`;
  return {
    content: [{
      type: 'text',
      text: `Dashboard de consommation disponible sur ${url}\n\nPour l'ouvrir dans VS Code (onglet Simple Browser), exécute :\n\`code --open-url "${url}"\`\n\nLe serveur tourne en arrière-plan et se met à jour automatiquement.`,
    }],
  };
}

/** Stop the dashboard server (called on MCP shutdown). */
export function stopDashboardServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    activePort = null;
  }
}
