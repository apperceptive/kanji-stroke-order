# kanji-stroke-order MCP

Hosted MCP server that returns KanjiVG stroke order data for kanji characters. Part of the [Apperceptive](https://github.com/apperceptive) platform.

## What it does

Exposes a single MCP tool, `get_stroke_order`, that takes a kanji character and returns:

- The raw KanjiVG SVG inner content (mincho style)
- Stroke count
- The character itself

The MCP is a pure data lookup. Rendering — animation, coloring, stroke width, speed — is the harness's job. The tool description explains the SVG structure so any Claude instance knows what to do with the data.

## Data source

Firestore project `kanjiism-65892`, collection `kanji`, document key = the character. Covers Jōyō kanji and many additional characters.

## Local development

1. Get a Firebase service account key for `kanjiism-65892` and save it as `service-account.json` in the repo root (this file is gitignored).
2. Copy `.env.example` to `.env` and verify the values.
3. Install and run:

```bash
npm install
npm run dev
```

4. Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:8080/mcp
```

## Deploy to Cloud Run

```bash
gcloud run deploy kanji-stroke-order \
  --source . \
  --project kanjiism-65892 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars FIRESTORE_PROJECT_ID=kanjiism-65892
```

No service account key is needed in the container — Cloud Run uses Application Default Credentials with the project's service account.

## Connect to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kanji-stroke-order": {
      "url": "https://<your-cloud-run-url>/mcp"
    }
  }
}
```
