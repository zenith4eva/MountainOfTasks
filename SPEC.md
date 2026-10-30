# Mountain of Tasks — Spec

Personal, private Trello-style task tracker. Static web app on GitHub Pages, data in a private GitHub repo, local-first with full history.

## Hosting & repos
- App: `zenith4eva/MountainOfTasks` (public, code only, no secrets). Vite build deployed to GitHub Pages by Actions on push to `main`.
- Data: `zenith4eva/mountain-of-tasks-data` (private). All task data and attachments.
- Auth: fine-grained PAT scoped to the data repo, `contents: read/write`. Stored in browser only.

## Stack
Vite + React 19 + TypeScript, Tailwind, dnd-kit, Dexie (IndexedDB), TanStack Query. PWA (manifest + service worker, installable, offline). Design via taste-skill: Trello layout, own visual identity, light + dark, system preference + toggle.

## Data model (event-sourced)
- Truth = append-only events: `{ id, ts, device, type, payload }`.
- Files: `events/<boardId>/<YYYY-MM>.jsonl` (append-only), `boards/<boardId>.json` (derived snapshot, rewritten each sync), `meta.json` (`epoch`, boards index, labels, devices).
- State derived by replay, cached in IndexedDB.
- Merge = union of events sorted by `ts`. Same field edited on two devices: later `ts` wins, both kept in history. Card position = fractional index, concurrent moves never collide.
- Soft delete everywhere (`card.deleted`, `attachment.removed`); nothing is hard-deleted except via explicit purge.

## Entities
- Board: name, columns[], settings.
- Column: name, order, `countsAsDone`, optional WIP limit, archivable/renameable/reorderable.
- Card: title, markdown description, labels (global), due date, checklist, priority (none/low/med/high), comments (timestamped), attachments, cover image, completedAt.
- Labels: global, shared across boards.

## Done columns
Any `countsAsDone` column groups cards by completion month. Header shows `Oct 2026` with ◀ ▶ and a month/year picker (years → months with counts). Default current month; cannot move past current month. Past cards fully live (drag back, edit, comment).

## Sync
- Auto mode (default): debounce 3 s, commit with generated message `[iPhone] move "Fix auth" → Doing; add 2 cards`.
- Manual mode: pending badge, Commit button, editable message. Toggle in Settings.
- Pull: on open, every 60 s while visible, before each push. `GET` branch SHA; fetch files only if changed.
- Device name: defaulted from UA, editable in Settings; tags events and commits.

## History
- Contribution heatmap, year picker, click day → cards completed.
- Per-card timeline in modal.
- Journal: chronological feed of all events, filter by board/label/type/date/text. Any row → "View repo at this point".
- Settings → History: commit list (message, time, device). Per row: Preview (read-only board), Restore (new commit with old tree, safe default). Danger fold: Force reset (`main` ref moved with `force: true`, type repo name to confirm).
- Rollback bumps `epoch` in `meta.json`. Device with lower epoch drops cache + pending queue after warning with pending count, refetches.

## Attachments
- Committed into the data repo at `attachments/<cardId>/<attId>-<name>`. Metadata in `attachment.added` event (`name, size, mime, path, blob, sha256`; `blob` is the git blob sha). Fetched with token from `git/blobs/<sha>` (exact bytes) → blob URL.
- Release assets were the original plan but browsers cannot upload to `uploads.github.com` (no CORS headers).
- Limits: warn > 50 MB, refuse > 100 MB (GitHub's per-file limit). Offline: blob in IndexedDB, uploaded when online, "pending upload" badge.
- UI: thumbnails for images, icon+size otherwise, lightbox, download, set as card cover, paste/drag-drop to attach, `![](att:<id>)` in markdown.
- Delete soft; Settings → Storage lists orphaned assets, Purge hard-deletes.

## Token security
- 4- or 6-digit PIN → PBKDF2 600k iterations → AES-GCM key encrypts PAT. PIN per session. 5 wrong PINs wipes local token (repo untouched).
- Biometric: WebAuthn platform passkey + PRF extension derives key (Face ID / Windows Hello). PIN fallback when unsupported. Enroll from Settings.
- On 401: re-enter token screen.

## Search & nav
- `Ctrl+K` palette: cards across boards, switch board, commands (new card, theme, etc.).
- Per-board filter bar: labels, due, priority.

## Testing
- Vitest: event reducer, merge, fractional index, PIN crypto.
- Playwright smoke: load, add card, drag, reload persists.

## Assumptions
- Phone is iPhone, iOS 18+ (PRF support). Android Chrome 128+ also fine.
- No GitHub Pro: app repo public.
