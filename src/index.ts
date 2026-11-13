import { config } from 'dotenv';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { fileURLToPath } from 'node:url';

// The repo's .env, wherever the process was started from.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'kanji-stroke-order' });
});

// A bare-bones MCP Apps host for development (DEV_HOST=1). Never enabled in the deployed service.
if (process.env.DEV_HOST === '1') {
  app.get('/dev/host', (_req, res) => res.sendFile(fileURLToPath(new URL('../scripts/dev-host.html', import.meta.url))));
}

app.post('/mcp', async (req, res) => {
  // Which JSON-RPC method (and tool) each request carries, so a host that connects but never calls a tool is visible in the logs.
  for (const m of Array.isArray(req.body) ? req.body : [req.body]) {
    console.log(`mcp ${m?.method ?? 'response'}${m?.params?.name ? ` ${m.params.name}` : ''} ua=${req.get('user-agent') ?? ''}`);
    // A host lists what it supports (sampling, elicitation, extensions such as MCP Apps) only in initialize.
    if (m?.method === 'initialize') {
      console.log(`mcp initialize client=${JSON.stringify(m.params?.clientInfo ?? null)} capabilities=${JSON.stringify(m.params?.capabilities ?? null)}`);
    }
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT ?? '8080', 10);
app.listen(port, () => {
  console.log(`kanji-stroke-order MCP server listening on port ${port}`);
});
