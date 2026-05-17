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
