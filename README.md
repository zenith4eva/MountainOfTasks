# Mountain of Tasks

[![Deploy to Pages](https://github.com/zenith4eva/MountainOfTasks/actions/workflows/deploy.yml/badge.svg)](https://github.com/zenith4eva/MountainOfTasks/actions/workflows/deploy.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A personal, local-first kanban board that runs as a static PWA on GitHub Pages and syncs to a **private GitHub repo** you own. No server, no third-party backend: every change is an event committed to git, so you get full history, rollback and multi-device sync for free.

**Live app:** https://zenith4eva.github.io/MountainOfTasks/

<p align="center">
  <img src="docs/desktop.webp" alt="Dragging cards between columns and adding a card on desktop" width="620">
  <img src="docs/phone.webp" alt="Adding a card, ticking a checklist item and swiping between columns on a phone" width="200">
</p>

## Screenshots

**Web**

| Light | Dark |
| --- | --- |
| ![Board in light theme](docs/desktop-light.png) | ![Board in dark theme](docs/desktop-dark.png) |

![Card detail with markdown description, checklist and comments](docs/desktop-card.png)

![Ctrl+K palette searching cards](docs/desktop-palette.png)

**Phone**

<p>
  <img src="docs/phone-light.png" alt="Board on phone, light theme" width="240">
  <img src="docs/phone-dark.png" alt="Board on phone, dark theme" width="240">
  <img src="docs/phone-card.png" alt="Card detail on phone" width="240">
</p>

## Features

- **Boards, columns, cards** with drag and drop, WIP limits, labels, due dates, priority, checklists, comments, markdown descriptions and cover images.
- **Done columns** group completed cards by month, with a month/year picker.
- **Board backgrounds:** CSS presets (static and animated), an uploaded image or video stored in the data repo, or any image/video URL.
- **Attachments** (paste or drag-drop), stored in the data repo. Large screenshots are re-encoded to WebP (max 2048 px) before upload. Warns above 50 MB; refuses above 100 MB (GitHub's file limit).
- **Offline first.** Data lives in IndexedDB; the app works with no network and syncs when it comes back.
- **Sync** in auto mode (3 s debounce, generated commit messages like `[iPhone] move "Fix auth" → Doing`) or manual mode (pending badge, editable message).
- **History:** contribution heatmap, per-card timeline, a filterable journal of every event, and commit list with preview, restore and force reset.
- **`Ctrl+K` / `⌘K` palette** for cards, boards and commands.
- **Locked token:** your GitHub token is encrypted on-device with a 4- or 6-digit PIN (PBKDF2, 600k iterations, AES-GCM) or a biometric passkey (WebAuthn PRF: Face ID, Windows Hello).
- Light and dark themes, installable on phone and desktop.

## How it works

Data is event-sourced. The private data repo holds:

| Path | Contents |
| --- | --- |
| `events/<boardId>/<YYYY-MM>.jsonl` | Append-only events, the source of truth |
| `boards/<boardId>.json` | Derived snapshot, rewritten each sync |
| `meta.json` | Epoch, board index, labels, devices |
| `attachments/<cardId>/…` | Attachment files |

State is rebuilt by replaying events. Merging two devices is a union of events sorted by timestamp; the later edit to a field wins and both stay in history. Card order uses fractional indexes, so concurrent moves never collide. Deletes are soft. A restore or force reset bumps the `epoch`, and other devices drop their cache and refetch.

See [SPEC.md](SPEC.md) for the full design.

## Using it

Open **[zenith4eva.github.io/MountainOfTasks](https://zenith4eva.github.io/MountainOfTasks/)**.

**Try it with nothing to set up:** press **Start now**. Your tasks stay on that device, and you can connect GitHub later from Settings; everything you made so far gets synced then.

**Sync across devices (about 2 minutes):** press **Sync with GitHub** and follow the three steps. The app opens GitHub with both forms already filled in, and shows a sketch of each page so you know what to press.

<img src="docs/onboarding-desktop-1-welcome.png" width="420" alt="Welcome screen with Start now and Sync with GitHub">

1. **Create a private repo.** The link opens GitHub with the name (`mountain-of-tasks-data`) and *Private* already set: press **Create repository**.
2. **Create an access token.** The link pre-fills the name, a one-year expiry and **Contents: Read and write**. The one thing GitHub won't let a link fill in is which repo the token may see, so: under **Repository access** choose **Only select repositories** and pick your repo. Then **Generate token** and copy it.
3. **Paste the token.** The app finds your repo by itself. If the token can't see it, the app says exactly which setting to change.

<img src="docs/onboarding-desktop-3-token.png" width="420" alt="Token step: numbered sketch of GitHub's token form"> <img src="docs/onboarding-phone-4-fix-access.png" width="200" alt="Error that shows how to give the token access to the repo">

Then choose a 4- or 6-digit PIN. The token is encrypted with it and stays in that browser; it is only ever sent to `api.github.com`. Five wrong PINs wipe the token from that device. Your repo is untouched.

**Install it** for a full-screen app that opens offline: the welcome screen and Settings → App show an **Install** button in Chrome, Edge and on Android. On iPhone and iPad, tap **Share**, then **Add to Home Screen**.

On another device, open the app, choose **Sync with GitHub**, and paste a token (the same one works, or make one per device).

## Development

Requires Node 24.

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Vitest unit tests (reducer, merge, fractional index, crypto) |
| `npm run e2e` | Playwright smoke test |
| `npm run shots` | Regenerate the screenshots and animations in `docs/` (needs Python 3 with Pillow) |

The sync integration test runs against a real throwaway repo and is skipped unless both variables are set:

```bash
SYNC_TEST_REPO=owner/name GH_TOKEN=$(gh auth token) npx vitest run tests/sync.int.test.ts
```

### Stack

Vite, React 19, TypeScript, Tailwind CSS 4, dnd-kit, Dexie (IndexedDB), TanStack Query, vite-plugin-pwa.

### Deploy

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): tests, build, then publish to GitHub Pages. The Vite `base` is `/MountainOfTasks/`; change it in [vite.config.ts](vite.config.ts) if you fork under another name.
