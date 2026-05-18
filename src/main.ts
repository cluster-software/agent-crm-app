import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPty } from "node-pty";
import * as nodePty from "node-pty";
import type {
  CreateRecordPayload,
  ImportCsvPayload,
  QueryResult,
  RecordPreview,
  TranscriptImportResult,
  TranscriptPayload,
  WorkspaceSummary
} from "./shared/types.js";
import { createWorkspaceWatcher } from "./workspace-watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let sdkClient: SdkServiceClient | null = null;
const workspaceWatcher = createWorkspaceWatcher(() => {
  mainWindow?.webContents.send("workspace:changed");
});

type RpcResponse<T> =
  | { id: number; result: T }
  | { id: number; error: { message: string; name?: string; stack?: string } };

class SdkServiceClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private buffer = "";

  async request<T>(method: string, ...params: unknown[]): Promise<T> {
    this.ensureStarted();
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.child?.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async dispose() {
    if (!this.child) return;
    try {
      await this.request("closeWorkspace");
    } catch {
      // The process may already be exiting; killing below is enough.
    }
    this.child.kill();
    this.child = null;
  }

  private ensureStarted() {
    if (this.child) return;

    // In packaged builds the sidecar script (and the native modules it loads)
    // live under app.asar.unpacked; spawn can't traverse into app.asar itself.
    const scriptPath = path
      .join(__dirname, "sdk-service.js")
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    // Run the sidecar via Electron's bundled Node (ELECTRON_RUN_AS_NODE) so we
    // don't depend on the user having Node installed and there's no ABI drift.
    const nodeBinary = process.env.SDK_NODE_BINARY ?? process.execPath;
    const child = spawn(nodeBinary, [scriptPath], {
      cwd: path.dirname(scriptPath),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "0"
      }
    });

    this.child = child;
    this.buffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line) this.handleLine(line);
        index = this.buffer.indexOf("\n");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      console.error(`[sdk-service] ${chunk}`);
    });

    child.on("error", (error) => {
      this.rejectAll(error);
      this.child = null;
    });

    child.on("exit", (code, signal) => {
      this.rejectAll(new Error(`SDK service exited (${signal ?? code ?? "unknown"}).`));
      this.child = null;
    });
  }

  private handleLine(line: string) {
    let message: RpcResponse<unknown>;
    try {
      message = JSON.parse(line) as RpcResponse<unknown>;
    } catch {
      console.warn(`[sdk-service] ${line}`);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if ("error" in message) {
      const error = new Error(message.error.message);
      error.name = message.error.name ?? "SdkServiceError";
      error.stack = message.error.stack;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function getSdkClient() {
  sdkClient ??= new SdkServiceClient();
  return sdkClient;
}

type PtySession = {
  proc: IPty;
  cwd: string;
  buffer: string;      // rolling history (~64 KB)
  pending: string;     // current batch waiting to flush
  flushTimer: NodeJS.Timeout | null;
};

const ptySessions = new Map<string, PtySession>();
const MAX_BUFFER_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 16;

function defaultShell() {
  if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
  return process.env.SHELL ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

function defaultShellArgs(): string[] {
  if (process.platform === "win32") return [];
  return ["-il"];
}

function defaultCwd() {
  const home = os.homedir();
  return home && home.length > 0 ? home : process.cwd();
}

const AGENT_CRM_ROOT = path.join(os.homedir(), "agent-crm");

function slugifyWorkspace(input: string): string {
  const stripped = input.toLowerCase().replace(/\.acrm$/i, "");
  const cleaned = stripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned.slice(0, 40) || "workspace");
}

function shortHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
}

// Resolves the cwd hint from the renderer (typically a `.acrm` file path) to
// a managed directory under `~/agent-crm/`. Workspace names can collide, so
// we suffix with a short hash of the full file path for uniqueness.
function resolveManagedCwd(hint?: string): string {
  if (!hint || hint.length === 0) {
    return AGENT_CRM_ROOT;
  }
  const slug = slugifyWorkspace(path.basename(hint));
  return path.join(AGENT_CRM_ROOT, `${slug}-${shortHash(hint)}`);
}

const claudeJsonPath = path.join(os.homedir(), ".claude.json");
const trustLocks = new Map<string, Promise<void>>();

// Mark `cwd` as trusted in `~/.claude.json` so Claude Code skips its first-run
// "Do you trust this folder?" prompt. Best-effort: callers should swallow errors.
async function ensureClaudeTrust(cwd: string): Promise<void> {
  const existing = trustLocks.get(cwd);
  if (existing) {
    await existing;
    return;
  }
  const task = (async () => {
    let config: Record<string, unknown> = {};
    try {
      const text = await fs.readFile(claudeJsonPath, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
    }
    const projects = (config.projects ??= {}) as Record<string, Record<string, unknown>>;
    const entry = (projects[cwd] ??= {});
    if (
      entry.hasTrustDialogAccepted === true &&
      entry.hasCompletedProjectOnboarding === true
    ) {
      return;
    }
    entry.hasTrustDialogAccepted = true;
    entry.hasCompletedProjectOnboarding = true;
    const tmp = `${claudeJsonPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmp, claudeJsonPath);
  })();
  trustLocks.set(cwd, task);
  try {
    await task;
  } finally {
    trustLocks.delete(cwd);
  }
}

function appendToBuffer(session: PtySession, data: string) {
  session.buffer += data;
  if (session.buffer.length > MAX_BUFFER_BYTES) {
    session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_BYTES);
  }
}

function flushPending(id: string, session: PtySession) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  if (session.pending.length === 0) return;
  const data = session.pending;
  session.pending = "";
  mainWindow?.webContents.send("pty:data", id, data);
}

function schedulePtyFlush(id: string, session: PtySession) {
  if (session.flushTimer) return;
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    if (session.pending.length === 0) return;
    const data = session.pending;
    session.pending = "";
    mainWindow?.webContents.send("pty:data", id, data);
  }, FLUSH_INTERVAL_MS);
}

function spawnPtySession(id: string, cols: number, rows: number, cwd: string): PtySession {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "agent-crm";

  const proc = nodePty.spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    cwd: cwd && cwd.length > 0 ? cwd : defaultCwd(),
    env
  });

  const session: PtySession = {
    proc,
    cwd,
    buffer: "",
    pending: "",
    flushTimer: null
  };

  proc.onData((data) => {
    appendToBuffer(session, data);
    session.pending += data;
    schedulePtyFlush(id, session);
  });

  proc.onExit(({ exitCode, signal }) => {
    flushPending(id, session);
    ptySessions.delete(id);
    mainWindow?.webContents.send("pty:exit", id, { exitCode, signal });
  });

  ptySessions.set(id, session);
  return session;
}

function killPtySession(id: string) {
  const session = ptySessions.get(id);
  if (!session) return;
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  try {
    session.proc.kill();
  } catch {
    // ignore — already gone
  }
  ptySessions.delete(id);
}

function killAllPtys() {
  for (const id of [...ptySessions.keys()]) killPtySession(id);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    backgroundColor: "#11100f",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

function handle<TArgs extends unknown[], TResult>(
  channel: string,
  fn: (...args: TArgs) => Promise<TResult>
) {
  ipcMain.handle(channel, async (_event, ...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw new Error(JSON.stringify(serializeError(error)));
    }
  });
}

async function openAndWatch(filePath: string): Promise<WorkspaceSummary> {
  const summary = await getSdkClient().request<WorkspaceSummary>("openWorkspace", filePath);
  if (summary?.path) workspaceWatcher.start(summary.path);
  return summary;
}

handle("workspace:open-dialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Agent CRM workspace",
    properties: ["openFile"],
    filters: [{ name: "Agent CRM workspace", extensions: ["acrm"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return openAndWatch(result.filePaths[0]);
});

handle("workspace:create-dialog", async () => {
  const result = await dialog.showSaveDialog({
    title: "Create Agent CRM workspace",
    defaultPath: "workspace.acrm",
    filters: [{ name: "Agent CRM workspace", extensions: ["acrm"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  const filePath = result.filePath.endsWith(".acrm") ? result.filePath : `${result.filePath}.acrm`;
  const summary = await getSdkClient().request<WorkspaceSummary>("createWorkspace", filePath);
  if (summary?.path) workspaceWatcher.start(summary.path);
  return summary;
});

handle("workspace:open-path", (filePath: string) => {
  return openAndWatch(filePath);
});
handle("workspace:close", async () => {
  workspaceWatcher.stop();
  await getSdkClient().request<void>("closeWorkspace");
});
handle("workspace:get", () => {
  return getSdkClient().request<WorkspaceSummary | null>("getWorkspace");
});
handle("records:list", (objectSlug: string) => {
  return getSdkClient().request<RecordPreview[]>("listRecords", objectSlug);
});
handle("records:create", (payload: CreateRecordPayload) => {
  return getSdkClient().request("createRecord", payload);
});
handle("import:csv", (payload: ImportCsvPayload) => {
  return getSdkClient().request("importCsv", payload);
});
handle("import:transcript", (payload: TranscriptPayload) => {
  return getSdkClient().request<TranscriptImportResult>("importTranscript", payload);
});
handle("query:run", (sql: string, params: unknown[] = []): Promise<QueryResult> => {
  return getSdkClient().request("runQuery", sql, params);
});

handle("pty:subscribe", async (id: string, cols: number, rows: number, cwd?: string) => {
  const resolvedCwd = resolveManagedCwd(cwd);
  await fs.mkdir(resolvedCwd, { recursive: true });
  try {
    await ensureClaudeTrust(resolvedCwd);
  } catch {
    // best-effort — don't block PTY spawn if the trust write fails
  }
  const existing = ptySessions.get(id);
  if (existing && existing.cwd === resolvedCwd) {
    // Reattach: flush any pending so the renderer sees a coherent state, return rolling buffer.
    flushPending(id, existing);
    try {
      existing.proc.resize(Math.max(2, cols), Math.max(1, rows));
    } catch {
      // ignore
    }
    return existing.buffer;
  }
  if (existing) {
    // Same session id with a different cwd — wipe and respawn fresh.
    killPtySession(id);
  }
  spawnPtySession(id, cols, rows, resolvedCwd);
  return "";
});
ipcMain.on("pty:input", (_event, id: string, data: string) => {
  const session = ptySessions.get(id);
  if (!session) return;
  try {
    session.proc.write(data);
  } catch {
    // ignore — child likely exiting
  }
});
ipcMain.on("pty:resize", (_event, id: string, cols: number, rows: number) => {
  const session = ptySessions.get(id);
  if (!session) return;
  try {
    session.proc.resize(Math.max(2, cols), Math.max(1, rows));
  } catch {
    // EBADF / ENOTTY when child is gone — ignore
  }
});
ipcMain.on("pty:kill", (_event, id: string) => {
  killPtySession(id);
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  workspaceWatcher.stop();
  killAllPtys();
  void sdkClient?.dispose();
});
