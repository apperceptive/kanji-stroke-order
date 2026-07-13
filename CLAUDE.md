# kanji-stroke-order MCP

Hosted MCP server under `apperceptive/kanji-stroke-order`. Returns KanjiVG SVG stroke order data for kanji characters. Part of the Apperceptive platform (Myers Media LLC).

## What this server does and does NOT do

**Does:** Character → raw KanjiVG SVG + stroke count. Pure data lookup.

**Does not:** Animate, color, parse, or render anything. No rendering parameters. The harness (Claude or any client) does all of that using the SVG data and the tool description as a guide.

## Firestore

- **Project:** `kanjiism-65892` (shared with the Kanjiism app)
- **Collection:** `kanji`
- **Document key:** the kanji character itself (e.g. `犬`)
- **Relevant fields:**
  - `strokes.mincho.svg` — raw KanjiVG SVG inner content (mincho style, v1 only)
  - `strokes.kaisho.svg` — kaisho style (deferred to v2)
  - `stroke_count` — integer

## Source files

| File | Role |
|------|------|
| `src/index.ts` | Express HTTP server; `POST /mcp` → MCP transport; `GET /` health check |
| `src/server.ts` | Creates `McpServer` instance and registers tools |
| `src/data/firestore.ts` | Firebase Admin init + `getKanji(character)` |
| `src/tools/stroke-order.ts` | `get_stroke_order` tool: Zod schema, description, handler |

## Local dev

Requires:
- `service-account.json` — Firebase service account key for `kanjiism-65892` (gitignored)
- `.env` copied from `.env.example`

```bash
npm install
npm run dev        # runs via tsx (no build step needed)
```

Test with Inspector:
```bash
npx @modelcontextprotocol/inspector http://localhost:8080/mcp
```

## Deploy

```bash
gcloud run deploy kanji-stroke-order \
  --source . \
  --project kanjiism-65892 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars FIRESTORE_PROJECT_ID=kanjiism-65892
```

No service account key in the container — Cloud Run uses ADC.

## npm package

Name: `mcp-kanji-stroke-order` — reserved for future local/npx distribution.

## Repo location

`C:\Users\User\repos\kanji-stroke-order\`
GitHub: `apperceptive/kanji-stroke-order` (private)
