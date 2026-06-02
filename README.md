# Agent CRM App

Premium Electron front-end for [`@agent-crm/sdk`](https://www.npmjs.com/package/@agent-crm/sdk). The app connects to Postgres-compatible Agent CRM workspaces and exposes common SDK workflows through a desktop UI.

## What It Does

Agent CRM App is a local desktop client for Agent CRM workspaces. It uses the SDK to:

- create new Postgres-backed workspaces
- open existing Postgres-compatible workspace databases
- load the workspace schema dynamically
- browse records by schema object
- create records with SDK field syntax
- import CSV rows
- import meeting transcripts
- import connected Gmail data from the hosted sync engine into the shared Postgres workspace

The sidebar is schema-driven. It reads objects from the open workspace through typed workspace APIs and renders them dynamically. The built-in SDK objects are:

- `companies`
- `people`
- `deals`
- `posts`
- `transcripts`
- `communication_threads`
- `communication_messages`

Those default objects get a preferred display order and icons, but the list itself comes from the workspace schema. Additional custom objects should appear after the SDK defaults.

## How It Works

The app has three runtime layers:

1. **Electron main process**: owns the native window, file dialogs, and IPC handlers.
2. **Node SDK sidecar**: runs `@agent-crm/sdk` operations in a separate Node process.
3. **React renderer**: renders the app UI and talks to Electron through a secure preload bridge.

The sidecar keeps SDK/database work out of the Electron main process and gives the packaged app a narrow JSON-RPC boundary for workspace operations.

High-level flow:

```text
React UI
  -> window.crm preload bridge
  -> Electron IPC handlers
  -> JSON-RPC over stdio
  -> Node SDK sidecar
  -> @agent-crm/sdk
  -> Postgres workspace
```

Gmail sync flow:

```text
/acrm-onboarding
  -> hosted Google OAuth
  -> sync engine / Supabase cache
  -> Electron background pull
  -> @agent-crm/sdk
  -> Postgres workspace
```

The app never starts Google OAuth from the UI. It only checks whether Gmail is already connected for the open workspace, then imports exported Gmail data locally.

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

Use **Create** to initialize a fresh Postgres workspace, or **Open** to connect to an existing Postgres-compatible database.

The app stores hosted-sync metadata in the workspace support directory in `.agent-crm-cloud.json`:

```json
{
  "workspaceId": "...",
  "clientToken": "...",
  "createdAt": "..."
}
```

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
npm run rebuild:native  # Rebuild native Electron modules for the current runtime
```
