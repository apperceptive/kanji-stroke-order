import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

test('the compass is listed as an app a host can open with no arguments', async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: 'entry-point-test', version: '0' });
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    const compass = tools.find((t) => t.name === 'open_compass');
    assert.ok(compass, 'open_compass is listed');
    const meta = compass._meta as { ui: { resourceUri: string; visibility?: string[] }; 'openai/ui'?: unknown };
    assert.deepEqual(meta['openai/ui'], { entrypoints: [{ type: 'global' }] });
    assert.equal(meta.ui.resourceUri, 'ui://nihongoism/compass.html');
    assert.ok(!meta.ui.visibility || meta.ui.visibility.includes('model'), 'a host lists only tools the model can see');
    assert.deepEqual(compass.inputSchema.required ?? [], [], 'an entry point calls the tool with {}');
  } finally {
    await client.close();
  }
});
