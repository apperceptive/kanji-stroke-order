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

## Nihongoism MCP Apps (prototype)

Two interactive apps, served over the same `/mcp` endpoint, for judging whether the experience is engaging in a real host. They record nothing and call no model.

| Tool | App | What the learner can do |
|------|-----|-------------------------|
| `show_strokes` | Stroke player | Watch a kanji brushed stroke by stroke, and play, pause, step either way, scrub and replay at their own pace. Drawn by the brush-kanji engine from KanjiVG strokes. |
| `open_compass` | Kanji compass | Opens as a compact card (the hub, a scrolling row of up to six related kanji labeled with their relations, and two actions); choose a neighbor to make it the hub. Expand opens the full compass (fullscreen where the host offers it, otherwise inline) with the ring, relation filters, and a quiz whose wrong options name the relation that caused them. |

Relations (Apperceptive Pedagogy D-P9), computed from KanjiVG's component tree and the jōyō readings:

- `built-on`: the neighbor contains the hub as a part at any depth.
- `shares-part`: a shared visible top-level part, with whether the part does the same job in both. A part marked as the sound part in both kanji but read differently is labeled as a break.
- `phonetic-series`: a shared sound part (KanjiVG's `kvg:phon`) and a shared on-reading; a reading that differs only in voicing counts (シ beside ジ).

The ring ranks kanji the learner has met first (the host passes `met`; a demo learner is assumed otherwise). A new kanji that is easy to confuse with another new one this session waits ("later"), except carriers of one series (P-025). Wrong-answer options are drawn from met kanji only.

```bash
npm install
npm run graph      # only to regenerate data/graph.json; needs the V1 data folder and service-account.json
npm run dev        # builds ui-dist/, serves /mcp on PORT; DEV_HOST=1 also serves /dev/host
npm test
```

`KANJIVG_DIR` points strokes at a folder of KanjiVG SVGs instead of Firestore. `DEV_HOST=1` serves `/dev/host`, a bare-bones MCP Apps host for development only.
