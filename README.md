# Agent CRM App

Premium Electron front-end for [`@agent-crm/sdk`](https://www.npmjs.com/package/@agent-crm/sdk). The app opens or creates `.acrm` workspaces and exposes common SDK workflows through a desktop UI.

## What It Does

Agent CRM App is a local desktop client for Agent CRM workspaces. It uses the SDK to:

- create new `.acrm` workspace files
- open existing `.acrm` workspace files
- load the workspace schema dynamically
- browse records by schema object
- create records with SDK field syntax
- import CSV rows
- import meeting transcripts
- run SQL queries against the workspace

The sidebar is schema-driven. It reads objects from the open workspace through `dumpSchema()` and renders them dynamically. The built-in SDK objects are:

- `companies`
- `people`
- `deals`
- `posts`
- `transcripts`

Those default objects get a preferred display order and icons, but the list itself comes from the workspace schema. Additional custom objects should appear after the SDK defaults.

## How It Works

The app has three runtime layers:

1. **Electron main process**: owns the native window, file dialogs, and IPC handlers.
2. **Node SDK sidecar**: runs `@agent-crm/sdk` operations in a separate Node process.
3. **React renderer**: renders the app UI and talks to Electron through a secure preload bridge.

The sidecar exists because the SDK depends on native SQLite bindings through `better-sqlite3`. Running SDK code in a normal Node process avoids Electron native-module ABI issues.

High-level flow:

```text
React UI
  -> window.crm preload bridge
  -> Electron IPC handlers
  -> JSON-RPC over stdio
  -> Node SDK sidecar
  -> @agent-crm/sdk
  -> .acrm workspace file
```

## Project Structure

```text
src/main.ts              Electron app shell, window setup, IPC, sidecar client
src/preload.ts           Secure renderer API exposed as window.crm
src/sdk-service.ts       Node sidecar that owns Workspace handles and SDK calls
src/shared/types.ts      Shared IPC and UI data types
src/renderer/App.tsx     Main React application
src/renderer/api.ts      Browser preview fallback and renderer API binding
src/renderer/styles.css  App styling
```

## Requirements

- Node.js 20 or newer
- npm
- macOS is the currently tested desktop environment

The development sidecar launches `node` from `PATH` by default. You can override that with `SDK_NODE_BINARY` if needed:

```bash
SDK_NODE_BINARY=/path/to/node npm run dev
```

## Install

```bash
npm install
```

## Run The App

Start the Electron app in development mode:

```bash
npm run dev
```

This starts Vite on `127.0.0.1:5173`, compiles the Electron files, and opens the Electron shell.

Use **Create** to create a fresh `.acrm` workspace, or **Open** to choose an existing workspace file.

## Browser Preview

For renderer-only UI work:

```bash
npm run dev:web
```

Then open:

```text
http://127.0.0.1:5173/
```

Browser preview mode does not use Electron, file dialogs, or the real SDK. It uses sample data from `src/renderer/api.ts` so UI changes can be checked quickly.

## Build

```bash
npm run build
```

This runs TypeScript checks for both renderer and Electron code, compiles Electron files into `dist/electron`, and builds the renderer into `dist/renderer`.

Run the production entry locally:

```bash
npm start
```

## Available Scripts

```bash
npm run dev             # Start Vite and Electron together
npm run dev:web         # Start renderer-only browser preview
npm run typecheck       # Type-check renderer and Electron TypeScript
npm run build:electron  # Compile Electron main/preload/sidecar files
npm run build           # Type-check and build the full app
npm start               # Build, then launch Electron from dist
npm run rebuild:native  # Rebuild better-sqlite3 for the current Node runtime
```

## Working With The SDK

Most SDK interaction lives in `src/sdk-service.ts`. Add new workspace operations there first, then expose them through:

1. a method in `src/sdk-service.ts`
2. an IPC handler in `src/main.ts`
3. the preload bridge in `src/preload.ts`
4. shared types in `src/shared/types.ts`
5. renderer calls through `window.crm`

This keeps SDK/native dependencies out of the renderer and centralizes workspace lifetime management in the sidecar.

## Working With Schema Objects

The app treats the SDK schema as the source of truth. On workspace load, the sidecar calls `dumpSchema()` and returns the object list in `WorkspaceSummary.objects`.

The renderer sorts known SDK objects into a stable order:

```text
companies -> people -> deals -> posts -> transcripts
```

Unknown/custom objects are still rendered after those defaults. Presentation helpers such as icons and ordering are allowed to know about SDK defaults; the actual sidebar list should continue to come from the loaded workspace schema.

## Common Workflows

### Create A Workspace

1. Run `npm run dev`.
2. Click **Create**.
3. Pick a path ending in `.acrm`.
4. The SDK creates the workspace and seeds the default objects and attributes.

### Browse Records

1. Open or create a workspace.
2. Select an object in the sidebar.
3. The app loads recent records for that object through the sidecar.

### Create A Record

1. Select an object in the sidebar.
2. Click **New record**.
3. Enter fields using SDK syntax:

```text
name=Acme
domains=acme.com
```

The field names must match attributes in the selected object schema.

### Import CSV

The CSV importer sends raw CSV text and a source label to `importCsv()`. The SDK handles recognized columns such as emails, names, company domains, and deal fields.

### Import Transcript

The transcript importer sends a `TranscriptPayload` to `importTranscript()`, including source, source ID, title, participants, summary, and content.

### Run SQL

The query view calls SDK `query()` and returns rows plus `rowsAffected`. This is useful for inspecting the EAV tables:

```sql
SELECT object_slug, COUNT(*) AS records
FROM acrm_record
GROUP BY object_slug
ORDER BY object_slug;
```

## Current Caveats

- The app is not yet packaged for distribution.
- The sidecar currently launches `node` from `PATH` in development. A packaged app should bundle or otherwise provide a known Node runtime.
- Workspace open/create currently replaces the active sidecar workspace during the operation. Failed opens should be hardened before relying on this for production workflows.
- There is no automated test suite yet. At minimum, add tests for sidecar RPC, failed workspace open/create behavior, IPC error formatting, and create/import/query flows against temporary `.acrm` files.

## Troubleshooting

### `better-sqlite3` fails to load

Rebuild native dependencies for your current Node runtime:

```bash
npm run rebuild:native
```

Then rerun:

```bash
npm run dev
```

### The Electron app cannot find `node`

Make sure `node` is available in `PATH`, or provide it explicitly:

```bash
SDK_NODE_BINARY=$(which node) npm run dev
```

### Port 5173 is already in use

Stop the existing Vite process or change the Vite port in `vite.config.ts`. The current dev script expects Vite on `127.0.0.1:5173`.

## Verification Checklist

Before opening a PR:

```bash
npm run build
npm audit
```

For UI changes, also run:

```bash
npm run dev:web
```

and inspect `http://127.0.0.1:5173/`.
