import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPty } from "node-pty";
import * as nodePty from "node-pty";
import type {
  CloudIntegrationsStatus,
  CloudSyncStatus,
  CreateRecordPayload,
  ImportCsvPayload,
  IntegrationAccountSummary,
  IntegrationProviderStatus,
  QueryResult,
  RecordListOptions,
  RecordListResult,
  SignalRunRequest,
  TranscriptImportResult,
  TranscriptPayload,
  UpdateStatus,
  WorkspaceSummary
} from "./shared/types.js";
import { createWorkspaceWatcher } from "./workspace-watcher.js";

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const devIconPath = path.join(__dirname, "../../build/icon.png");

let mainWindow: BrowserWindow | null = null;
let sdkClient: SdkServiceClient | null = null;
const cloudWorkspaceIdsByCwd = new Map<string, string>();
const cloudWorkspaceTokensByCwd = new Map<string, string>();
const syncEngineUrl = process.env.AGENT_CRM_SYNC_ENGINE_URL ?? "https://agent-crm-sync-engine.onrender.com";
let cloudSyncStatus: CloudSyncStatus = { state: "idle" };
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSyncWorkspace: WorkspaceSummary | null = null;
let cloudSyncInFlight: Promise<CloudSyncStatus> | null = null;

type CommunicationImportStats = {
  people_created: number;
  communication_threads_created: number;
  communication_messages_created: number;
};

function sendToMainWindow(channel: string, ...args: unknown[]) {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

const workspaceWatcher = createWorkspaceWatcher(() => {
  sendToMainWindow("workspace:changed");
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

type ShellCandidate = {
  command: string;
  args: string[];
};

function defaultShellArgs(command: string): string[] {
  if (process.platform === "win32") return [];
  const basename = path.basename(command).toLowerCase();
  if (basename === "sh") return ["-i"];
  return ["-il"];
}

function isExecutable(command: string): boolean {
  if (command.length === 0) return false;
  if (process.platform === "win32") return true;
  try {
    accessSync(command, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function shellCandidates(): ShellCandidate[] {
  const commands =
    process.platform === "win32"
      ? [process.env.ComSpec, "cmd.exe"]
      : [
          process.env.SHELL,
          process.platform === "darwin" ? "/bin/zsh" : "/bin/bash",
          "/bin/bash",
          "/bin/sh"
        ];
  const seen = new Set<string>();
  const candidates: ShellCandidate[] = [];

  for (const command of commands) {
    if (!command || seen.has(command) || !isExecutable(command)) continue;
    seen.add(command);
    candidates.push({ command, args: defaultShellArgs(command) });
  }

  return candidates;
}

function defaultCwd() {
  const home = os.homedir();
  return home && home.length > 0 ? home : process.cwd();
}

const AGENT_CRM_ROOT = path.join(os.homedir(), "agent-crm");
const CLOUD_METADATA_FILENAME = ".agent-crm-cloud.json";

function slugifyWorkspaceName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned;
}

// Allocate a fresh workspace directory under the chosen parent keyed off the
// user's workspace name. The `.acrm` file and the Claude Code PTY share this
// directory so they don't diverge. If `<slug>` is taken, append `-2`, `-3`,
// etc. until we find a free one.
async function allocateWorkspaceDir(slug: string, parentDir = AGENT_CRM_ROOT): Promise<string> {
  await fs.mkdir(parentDir, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
    const dir = path.join(parentDir, candidate);
    try {
      await fs.mkdir(dir);
      return dir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`Could not allocate a directory for workspace "${slug}"`);
}

// The PTY runs in the folder that holds the `.acrm` so Claude Code sees the
// same workspace as the Electron app. With no workspace open, fall back to
// the managed root.
function resolvePtyCwd(workspaceFile?: string): string {
  if (workspaceFile && workspaceFile.length > 0) {
    return path.dirname(workspaceFile);
  }
  return AGENT_CRM_ROOT;
}

async function withCloudWorkspace(summary: WorkspaceSummary): Promise<WorkspaceSummary> {
  if (!summary.path) return summary;
  const cwd = path.dirname(summary.path);
  const metadataPath = path.join(cwd, CLOUD_METADATA_FILENAME);
  let workspaceId: string | undefined;
  let clientToken: string | undefined;

  try {
    const parsed = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      workspaceId?: unknown;
      clientToken?: unknown;
    };
    if (typeof parsed.workspaceId === "string" && parsed.workspaceId.length > 0) {
      workspaceId = parsed.workspaceId;
    }
    if (typeof parsed.clientToken === "string" && parsed.clientToken.length > 0) {
      clientToken = parsed.clientToken;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(`[cloud-workspace] failed to read ${metadataPath}: ${(error as Error).message}`);
    }
  }

  if (!workspaceId || !clientToken) {
    workspaceId = workspaceId ?? randomUUID();
    clientToken = clientToken ?? randomUUID();
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify({
        workspaceId,
        clientToken,
        createdAt: new Date().toISOString()
      }, null, 2)}\n`,
      "utf8"
    );
  }

  cloudWorkspaceIdsByCwd.set(cwd, workspaceId);
  cloudWorkspaceTokensByCwd.set(cwd, clientToken);
  return {
    ...summary,
    cloudWorkspaceId: workspaceId
  };
}

function setCloudSyncStatus(status: CloudSyncStatus): CloudSyncStatus {
  cloudSyncStatus = status;
  sendToMainWindow("cloud-sync:status", status);
  return status;
}

function stopCloudSync() {
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  cloudSyncWorkspace = null;
  setCloudSyncStatus({ state: "idle" });
}

function startCloudSync(summary: WorkspaceSummary) {
  cloudSyncWorkspace = summary;
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  void runCloudSync();
}

function scheduleCloudSync() {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    void runCloudSync();
  }, 60_000);
}

async function runCloudSync(): Promise<CloudSyncStatus> {
  if (cloudSyncInFlight) return cloudSyncInFlight;
  cloudSyncInFlight = runCloudSyncOnce().finally(() => {
    cloudSyncInFlight = null;
  });
  return cloudSyncInFlight;
}

async function runCloudSyncOnce(): Promise<CloudSyncStatus> {
  const summary = cloudSyncWorkspace;
  if (!summary?.path || !summary.cloudWorkspaceId) {
    return setCloudSyncStatus({ state: "idle" });
  }

  const cwd = path.dirname(summary.path);
  const clientToken = cloudWorkspaceTokensByCwd.get(cwd);
  if (!clientToken) {
    return setCloudSyncStatus({ state: "error", message: "Cloud workspace token is missing." });
  }

  try {
    setCloudSyncStatus({ state: "checking" });
    const status = await fetchJson<{
      ok: true;
      integrations: {
        gmail?: {
          connected: boolean;
          accountEmail?: string;
          lastSyncedAt?: string;
        };
        linkedin?: {
          connected: boolean;
          providerAccountId?: string;
          lastSyncedAt?: string;
        };
        linkedin_unipile?: {
          connected: boolean;
          providerAccountId?: string;
          lastSyncedAt?: string;
        };
      };
    }>(`/workspaces/${encodeURIComponent(summary.cloudWorkspaceId)}/integrations/status`, clientToken);

    setCloudSyncStatus({ state: "syncing" });
    const aggregateStats: CommunicationImportStats = {
      people_created: 0,
      communication_threads_created: 0,
      communication_messages_created: 0
    };
    let syncedProviders = 0;

    if (status.integrations.gmail?.connected) {
      const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "gmail");
      addCommunicationStats(aggregateStats, stats);
      syncedProviders += 1;
    }

const linkedInStatus = status.integrations.linkedin ?? status.integrations.linkedin_unipile;
    if (linkedInStatus?.connected) {
      const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "linkedin", {
        ignoreMissingEndpoint: true
      });
      if (stats) {
        addCommunicationStats(aggregateStats, stats);
        syncedProviders += 1;
      }
    }

    if (syncedProviders === 0) {
      return setCloudSyncStatus({ state: "disconnected" });
    }

    sendToMainWindow("workspace:changed");
    scheduleCloudSync();
    return setCloudSyncStatus({
      state: "synced",
      lastSyncedAt: new Date().toISOString(),
      stats: aggregateStats
    });
  } catch (error) {
    return setCloudSyncStatus({
      state: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function importCloudCommunicationExport(
  workspaceId: string,
  clientToken: string,
  provider: "gmail" | "linkedin",
  options: { ignoreMissingEndpoint?: boolean } = {}
): Promise<CommunicationImportStats | undefined> {
  try {
    const exported = await fetchJson<{
      ok: true;
      data: unknown;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/export`, clientToken);
    const result = await getSdkClient().request<{
      stats?: Partial<CommunicationImportStats>;
    }>("importCommunicationBatch", exported.data);
    return {
      people_created: result.stats?.people_created ?? 0,
      communication_threads_created: result.stats?.communication_threads_created ?? 0,
      communication_messages_created: result.stats?.communication_messages_created ?? 0
    };
  } catch (error) {
    if (options.ignoreMissingEndpoint && error instanceof Error && error.message.includes("(404)")) {
      return undefined;
    }
    throw error;
  }
}

function addCommunicationStats(
  aggregate: CommunicationImportStats,
  next?: CommunicationImportStats
) {
  if (!next) return;
  aggregate.people_created += next.people_created;
  aggregate.communication_threads_created += next.communication_threads_created;
  aggregate.communication_messages_created += next.communication_messages_created;
}

async function fetchJson<T>(pathname: string, clientToken: string): Promise<T> {
  const url = new URL(pathname, syncEngineUrl);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${clientToken}`
    }
  });
  const payload = await response.json().catch(() => undefined) as T | undefined;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error)
      : `Cloud sync request failed (${response.status})`;
    throw new Error(error);
  }
  if (!payload) throw new Error("Cloud sync response was empty.");
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function normalizeIntegrationProvider(value: unknown): IntegrationProviderStatus {
  const source = isRecord(value) ? value : {};
  const accountEmail = stringField(source, "accountEmail", "account_email");
  const displayName = stringField(source, "displayName", "display_name");
  const providerAccountId = stringField(source, "providerAccountId", "provider_account_id");
  const lastSyncedAt = stringField(source, "lastSyncedAt", "last_synced_at");
  const status = stringField(source, "status");
  const accounts = Array.isArray(source.accounts)
    ? source.accounts.flatMap((account): IntegrationAccountSummary[] => {
        if (!isRecord(account)) return [];
        return [{
          id: stringField(account, "id"),
          providerAccountId: stringField(account, "providerAccountId", "provider_account_id"),
          accountEmail: stringField(account, "accountEmail", "account_email"),
          displayName: stringField(account, "displayName", "display_name"),
          status: stringField(account, "status"),
          lastSyncedAt: stringField(account, "lastSyncedAt", "last_synced_at")
        }];
      })
    : [];

  if (accounts.length === 0 && (accountEmail || displayName || providerAccountId || lastSyncedAt || status)) {
    accounts.push({
      accountEmail,
      displayName,
      providerAccountId,
      status,
      lastSyncedAt
    });
  }

  return {
    connected: source.connected === true || accounts.length > 0,
    ...(accountEmail ? { accountEmail } : {}),
    ...(displayName ? { displayName } : {}),
    ...(providerAccountId ? { providerAccountId } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
    ...(accounts.length > 0 ? { accounts } : {})
  };
}

async function getCloudIntegrationsStatus(): Promise<CloudIntegrationsStatus> {
  const current = cloudSyncWorkspace
    ?? await getSdkClient().request<WorkspaceSummary | null>("getWorkspace");
  if (!current?.path) return { state: "no_workspace" };

  const summary = current.cloudWorkspaceId ? current : await withCloudWorkspace(current);
  if (!summary.cloudWorkspaceId) return { state: "no_workspace" };

  const cwd = path.dirname(summary.path);
  const clientToken = cloudWorkspaceTokensByCwd.get(cwd);
  if (!clientToken) {
    return { state: "error", message: "Cloud workspace token is missing." };
  }

  try {
    const status = await fetchJson<{
      ok: true;
      integrations?: Record<string, unknown>;
    }>(`/workspaces/${encodeURIComponent(summary.cloudWorkspaceId)}/integrations/status`, clientToken);
    const integrations = isRecord(status.integrations) ? status.integrations : {};
    return {
      state: "ready",
      workspaceId: summary.cloudWorkspaceId,
      integrations: {
        gmail: normalizeIntegrationProvider(integrations.gmail),
        linkedin: normalizeIntegrationProvider(
          integrations.linkedin ?? integrations.linkedIn ?? integrations.linkedin_unipile
        )
      }
    };
  } catch (error) {
    return {
      state: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
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
  sendToMainWindow("pty:data", id, data);
}

function schedulePtyFlush(id: string, session: PtySession) {
  if (session.flushTimer) return;
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    if (session.pending.length === 0) return;
    const data = session.pending;
    session.pending = "";
    sendToMainWindow("pty:data", id, data);
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
  env.ACRM_SYNC_ENGINE_URL = syncEngineUrl;
  const cloudWorkspaceId = cloudWorkspaceIdsByCwd.get(cwd);
  if (cloudWorkspaceId) {
    env.ACRM_CLOUD_WORKSPACE_ID = cloudWorkspaceId;
  }
  const cloudWorkspaceClientToken = cloudWorkspaceTokensByCwd.get(cwd);
  if (cloudWorkspaceClientToken) {
    env.ACRM_CLOUD_WORKSPACE_CLIENT_TOKEN = cloudWorkspaceClientToken;
  }

  const candidates = shellCandidates();
  const attempts: string[] = [];
  let proc: IPty | null = null;

  for (const candidate of candidates) {
    try {
      proc = nodePty.spawn(candidate.command, candidate.args, {
        name: "xterm-256color",
        cols: Math.max(2, cols),
        rows: Math.max(1, rows),
        cwd: cwd && cwd.length > 0 ? cwd : defaultCwd(),
        env
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${candidate.command}: ${message}`);
    }
  }

  if (!proc) {
    const detail = attempts.length > 0 ? ` Attempts: ${attempts.join(" | ")}` : "";
    throw new Error(`Could not start an interactive shell.${detail}`);
  }

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
    sendToMainWindow("pty:exit", id, { exitCode, signal });
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
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    backgroundColor: "#11100f",
    icon: isDev ? devIconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });

  window.on("focus", () => {
    if (cloudSyncWorkspace && cloudSyncStatus.state !== "syncing" && cloudSyncStatus.state !== "checking") {
      void runCloudSync();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
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
  const summary = await withCloudWorkspace(
    await getSdkClient().request<WorkspaceSummary>("openWorkspace", filePath)
  );
  if (summary?.path) workspaceWatcher.start(summary.path);
  startCloudSync(summary);
  return summary;
}

handle("workspace:open-dialog", async () => {
  await fs.mkdir(AGENT_CRM_ROOT, { recursive: true });
  const result = await dialog.showOpenDialog({
    title: "Open Agent CRM workspace",
    defaultPath: AGENT_CRM_ROOT,
    properties: ["openFile"],
    filters: [{ name: "Agent CRM workspace", extensions: ["acrm"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return openAndWatch(result.filePaths[0]);
});

handle("workspace:choose-directory", async () => {
  await fs.mkdir(AGENT_CRM_ROOT, { recursive: true });
  const result = await dialog.showOpenDialog({
    title: "Choose workspace directory",
    defaultPath: AGENT_CRM_ROOT,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

handle("workspace:create", async (name: string, parentDir?: string) => {
  const slug = slugifyWorkspaceName(name ?? "");
  if (slug.length === 0) {
    throw new Error("Workspace name must include at least one letter or number.");
  }
  const dir = await allocateWorkspaceDir(slug, parentDir || AGENT_CRM_ROOT);
  const filePath = path.join(dir, `${slug}.acrm`);
  const summary = await withCloudWorkspace(
    await getSdkClient().request<WorkspaceSummary>("createWorkspace", filePath)
  );
  if (summary?.path) workspaceWatcher.start(summary.path);
  startCloudSync(summary);
  return summary;
});

handle("workspace:open-path", (filePath: string) => {
  return openAndWatch(filePath);
});
handle("workspace:close", async () => {
  workspaceWatcher.stop();
  stopCloudSync();
  await getSdkClient().request<void>("closeWorkspace");
});
handle("workspace:get", async () => {
  const summary = await getSdkClient().request<WorkspaceSummary | null>("getWorkspace");
  if (!summary) return null;
  const withCloud = await withCloudWorkspace(summary);
  if (!cloudSyncWorkspace || cloudSyncWorkspace.path !== withCloud.path) {
    startCloudSync(withCloud);
  }
  return withCloud;
});
handle("records:list", (objectSlug: string, options?: RecordListOptions) => {
  return getSdkClient().request<RecordListResult>("listRecords", objectSlug, options);
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
handle("signals:list", () => {
  return getSdkClient().request("listSignals");
});
handle("signals:failures", () => {
  return getSdkClient().request("listSignalFailures");
});
handle("signals:runs", () => {
  return getSdkClient().request("listSignalRuns");
});
handle("signals:sync", () => {
  return getSdkClient().request("syncSignals");
});
handle("signals:run", (request: SignalRunRequest = {}) => {
  return getSdkClient().request("runSignals", request);
});
handle("cloud-sync:get-status", async () => cloudSyncStatus);
handle("cloud-sync:trigger", async () => runCloudSync());
handle("cloud-integrations:get", async () => getCloudIntegrationsStatus());

handle("pty:subscribe", async (id: string, cols: number, rows: number, cwd?: string) => {
  const resolvedCwd = resolvePtyCwd(cwd);
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

let latestUpdateStatus: UpdateStatus = { state: "idle" };

function publishUpdateStatus(status: UpdateStatus) {
  latestUpdateStatus = status;
  sendToMainWindow("update:status", status);
}

function setupAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let pendingVersion = "";

  autoUpdater.on("checking-for-update", () => {
    publishUpdateStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version;
    publishUpdateStatus({ state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateStatus({ state: "idle" });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateStatus({
      state: "downloading",
      version: pendingVersion,
      percent: Math.round(progress.percent)
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateStatus({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    publishUpdateStatus({ state: "error", message: error?.message ?? String(error) });
  });

  void autoUpdater.checkForUpdates().catch(() => undefined);
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }, 30 * 60 * 1000);
}

ipcMain.handle("update:get-status", () => latestUpdateStatus);
ipcMain.handle("update:install", () => {
  if (latestUpdateStatus.state !== "ready") return;
  autoUpdater.quitAndInstall();
});

app
  .whenReady()
  .then(() => {
    if (isDev && process.platform === "darwin") app.dock?.setIcon(devIconPath);
    createWindow();
    setupAutoUpdater();
  })
  .catch((error) => {
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
  stopCloudSync();
  killAllPtys();
  void sdkClient?.dispose();
});
