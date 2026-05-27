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
  CloudSyncProvider,
  CreateRecordPayload,
  ImportCsvPayload,
  IntegrationAccountSummary,
  IntegrationProviderStatus,
  QueryResult,
  RecordListOptions,
  RecordListResult,
  RecentWorkspaceSummary,
  SignalRunRequest,
  TerminalDroppedFilePayload,
  TranscriptImportResult,
  TranscriptPayload,
  UpdateRecordPayload,
  UpdateRecordResult,
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
let cloudSyncInFlight: { generation: number; promise: Promise<CloudSyncStatus> } | null = null;
let cloudSyncGeneration = 0;
let cloudSyncShowInEmptyState = false;
const CLOUD_SYNC_IDLE_INTERVAL_MS = 60_000;
const CLOUD_SYNC_ACTIVE_INTERVAL_MS = 5_000;
const DEFAULT_EMPTY_RECORD_OBJECTS = ["companies", "people", "deals"] as const;

type CommunicationImportStats = {
  people_created: number;
  communication_threads_created: number;
  communication_messages_created: number;
};

type CloudSyncRunContext = {
  generation: number;
  workspacePath: string;
  cloudWorkspaceId: string;
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
    const child = this.child;
    if (!child || child.stdin.destroyed || child.stdin.writableEnded) {
      throw new Error("SDK service is not available.");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });

      child.stdin.write(`${payload}\n`, (error) => {
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

    child.stdin.on("error", (error) => {
      this.rejectAll(error);
      if (this.child === child) {
        this.child = null;
      }
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
const MAX_DROPPED_FILE_BYTES = 50 * 1024 * 1024;

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
const RECENT_WORKSPACES_FILENAME = "recent-workspaces.json";
const RECENT_WORKSPACE_DIRS = [
  { dir: AGENT_CRM_ROOT, depth: 2 },
  { dir: path.join(os.homedir(), "workspaces"), depth: 1 },
  { dir: path.join(os.homedir(), "Downloads"), depth: 1 }
] as const;

type PersistedRecentWorkspace = {
  path: string;
  openedAt: string;
};

type AgentWorkspaceInstructions = {
  filenames: readonly string[];
  startMarker: string;
  endMarker: string;
  block: string;
};

const EMERGENCY_AGENT_WORKSPACE_INSTRUCTIONS = {
  filenames: ["CLAUDE.md", "AGENTS.md"],
  startMarker: "<!-- agent-crm-app:start -->",
  endMarker: "<!-- agent-crm-app:end -->",
  block: [
    "<!-- agent-crm-app:start -->",
    "## Agent CRM Workspace",
    "",
    "The shared Agent CRM SDK instructions were unavailable when this workspace was created.",
    "",
    "Before using `acrm`:",
    "- Run `acrm --version`.",
    "- If `acrm` is missing or reports that a newer `@agent-crm/cli` is available, run `npm install -g @agent-crm/cli@latest`.",
    "- Run `acrm --help` and `acrm execute --help` for current workspace guidance.",
    "<!-- agent-crm-app:end -->",
    "",
  ].join("\n")
} as const;

let agentWorkspaceInstructionsPromise: Promise<AgentWorkspaceInstructions> | null = null;

type CloudMetadata = {
  workspaceId?: string;
  clientToken?: string;
  clusterOrgId?: string;
  localWorkspaceId?: string;
  createdAt?: string;
};

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

function normalizeAgentWorkspaceInstructions(input: unknown): AgentWorkspaceInstructions | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<AgentWorkspaceInstructions>;
  if (
    !Array.isArray(candidate.filenames) ||
    typeof candidate.startMarker !== "string" ||
    typeof candidate.endMarker !== "string" ||
    typeof candidate.block !== "string"
  ) {
    return null;
  }
  if (!candidate.filenames.every((filename) => typeof filename === "string")) {
    return null;
  }
  return {
    filenames: candidate.filenames,
    startMarker: candidate.startMarker,
    endMarker: candidate.endMarker,
    block: candidate.block
  };
}

async function loadAgentWorkspaceInstructions(): Promise<AgentWorkspaceInstructions> {
  if (!agentWorkspaceInstructionsPromise) {
    agentWorkspaceInstructionsPromise = (async () => {
      const message =
        "@agent-crm/sdk is missing AGENT_WORKSPACE_INSTRUCTIONS. Update @agent-crm/sdk before generating workspace agent files.";
      let cause: unknown;
      try {
        const sdk = (await import("@agent-crm/sdk")) as unknown as {
          AGENT_WORKSPACE_INSTRUCTIONS?: unknown;
        };
        const instructions = normalizeAgentWorkspaceInstructions(
          sdk.AGENT_WORKSPACE_INSTRUCTIONS
        );
        if (instructions) return instructions;
      } catch (error) {
        cause = error;
      }
      if (!app.isPackaged || process.env.CI) {
        throw new Error(cause instanceof Error ? `${message} ${cause.message}` : message);
      }
      console.warn(`[agent-instructions] ${message} Falling back to emergency instructions.`);
      return EMERGENCY_AGENT_WORKSPACE_INSTRUCTIONS;
    })();
  }
  return agentWorkspaceInstructionsPromise;
}

async function ensureAgentInstructionFilesInDir(workspaceDir: string): Promise<void> {
  const instructions = await loadAgentWorkspaceInstructions();
  await Promise.all(
    instructions.filenames.map((filename) =>
      upsertAgentInstructionBlock(path.join(workspaceDir, filename), instructions)
    )
  );
}

async function ensureAgentInstructionFiles(workspaceFile: string): Promise<void> {
  await ensureAgentInstructionFilesInDir(path.dirname(workspaceFile));
}

async function upsertAgentInstructionBlock(
  filePath: string,
  instructions: AgentWorkspaceInstructions
): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw error;
  }

  const start = existing.indexOf(instructions.startMarker);
  const end = existing.indexOf(instructions.endMarker);
  let next: string;

  if (start >= 0 && end >= start) {
    const afterEnd = end + instructions.endMarker.length;
    next = `${existing.slice(0, start)}${instructions.block}${existing.slice(afterEnd)}`;
  } else if (existing.trim().length === 0) {
    next = instructions.block;
  } else {
    next = `${existing.replace(/\s*$/, "")}\n\n${instructions.block}`;
  }

  if (next === existing) return;
  await fs.writeFile(filePath, next, "utf8");
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
  const localWorkspaceId = await getSdkClient().request<string>("ensureWorkspaceIdentity");
  let metadata = await readCloudMetadata(metadataPath);

  if (metadata.workspaceId && metadata.clientToken) {
    if (metadata.localWorkspaceId && metadata.localWorkspaceId !== localWorkspaceId) {
      await archiveCloudMetadata(metadataPath);
      metadata = {};
    } else if (!metadata.localWorkspaceId && await shouldRotateLegacySidecar(metadata, metadataPath, summary.path)) {
      await archiveCloudMetadata(metadataPath);
      metadata = {};
    }
  }

  let workspaceId = metadata.workspaceId;
  let clientToken = metadata.clientToken;

  if (!workspaceId || !clientToken) {
    workspaceId = workspaceId ?? randomUUID();
    clientToken = clientToken ?? randomUUID();
  }

  if (
    workspaceId !== metadata.workspaceId ||
    clientToken !== metadata.clientToken ||
    localWorkspaceId !== metadata.localWorkspaceId
  ) {
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify({
        ...metadata,
        workspaceId,
        clientToken,
        localWorkspaceId,
        createdAt: metadata.createdAt ?? new Date().toISOString()
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

async function readCloudMetadata(metadataPath: string): Promise<CloudMetadata> {
  try {
    const parsed = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
    return {
      ...(typeof parsed.workspaceId === "string" && parsed.workspaceId.length > 0
        ? { workspaceId: parsed.workspaceId }
        : {}),
      ...(typeof parsed.clientToken === "string" && parsed.clientToken.length > 0
        ? { clientToken: parsed.clientToken }
        : {}),
      ...(typeof parsed.clusterOrgId === "string" && parsed.clusterOrgId.length > 0
        ? { clusterOrgId: parsed.clusterOrgId }
        : {}),
      ...(typeof parsed.localWorkspaceId === "string" && parsed.localWorkspaceId.length > 0
        ? { localWorkspaceId: parsed.localWorkspaceId }
        : {}),
      ...(typeof parsed.createdAt === "string" && parsed.createdAt.length > 0
        ? { createdAt: parsed.createdAt }
        : {})
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(`[cloud-workspace] failed to read ${metadataPath}: ${(error as Error).message}`);
    }
    return {};
  }
}

async function shouldRotateLegacySidecar(
  metadata: CloudMetadata,
  metadataPath: string,
  workspacePath: string
): Promise<boolean> {
  const sidecarCreatedAt = Date.parse(metadata.createdAt ?? "");
  try {
    const [sidecarStat, workspaceStat] = await Promise.all([
      fs.stat(metadataPath),
      fs.stat(workspacePath)
    ]);
    const sidecarTimestamp = Number.isNaN(sidecarCreatedAt)
      ? Math.max(sidecarStat.birthtimeMs, sidecarStat.mtimeMs)
      : sidecarCreatedAt;
    const workspaceTimestamp = Math.max(workspaceStat.birthtimeMs, workspaceStat.mtimeMs);
    return sidecarStat.isFile() && workspaceTimestamp > sidecarTimestamp;
  } catch {
    return false;
  }
}

async function archiveCloudMetadata(metadataPath: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let target = `${metadataPath}.stale-${timestamp}`;
  let suffix = 1;
  while (true) {
    try {
      await fs.rename(metadataPath, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EEXIST") throw error;
      target = `${metadataPath}.stale-${timestamp}-${suffix}`;
      suffix++;
    }
  }
}

function setCloudSyncStatus(status: CloudSyncStatus): CloudSyncStatus {
  cloudSyncStatus = status;
  sendToMainWindow("cloud-sync:status", status);
  return status;
}

function isCurrentCloudSyncRun(run: CloudSyncRunContext): boolean {
  return (
    cloudSyncGeneration === run.generation &&
    cloudSyncWorkspace?.path === run.workspacePath &&
    cloudSyncWorkspace?.cloudWorkspaceId === run.cloudWorkspaceId
  );
}

function setCloudSyncStatusForRun(run: CloudSyncRunContext, status: CloudSyncStatus): CloudSyncStatus {
  if (!isCurrentCloudSyncRun(run)) return status;
  return setCloudSyncStatus(status);
}

function setCloudSyncCheckingForRun(run: CloudSyncRunContext): CloudSyncStatus {
  if (!isCurrentCloudSyncRun(run)) return { state: "checking" };
  if (cloudSyncStatus.state === "syncing") return cloudSyncStatus;
  return setCloudSyncStatus({ state: "checking" });
}

function scheduleCloudSyncForRun(run: CloudSyncRunContext, delayMs?: number): void {
  if (!isCurrentCloudSyncRun(run)) return;
  scheduleCloudSync(delayMs);
}

function clearEmptyStateSyncForRun(run: CloudSyncRunContext): void {
  if (!isCurrentCloudSyncRun(run)) return;
  cloudSyncShowInEmptyState = false;
}

function updateCloudSyncWorkspace(summary: WorkspaceSummary): void {
  if (!cloudSyncWorkspace || cloudSyncWorkspace.path !== summary.path) return;
  cloudSyncWorkspace = summary;
  if (!isDefaultRecordsWorkspaceEmpty(summary)) {
    cloudSyncShowInEmptyState = false;
    if (cloudSyncStatus.state === "syncing" && cloudSyncStatus.showInEmptyState === true) {
      setCloudSyncStatus({
        ...cloudSyncStatus,
        showInEmptyState: false
      });
    }
  }
}

function stopCloudSync() {
  cloudSyncGeneration++;
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  cloudSyncWorkspace = null;
  cloudSyncShowInEmptyState = false;
  setCloudSyncStatus({ state: "idle" });
}

function startCloudSync(summary: WorkspaceSummary) {
  cloudSyncGeneration++;
  cloudSyncWorkspace = summary;
  cloudSyncShowInEmptyState = isDefaultRecordsWorkspaceEmpty(summary);
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  void runCloudSync();
}

function scheduleCloudSync(delayMs = CLOUD_SYNC_IDLE_INTERVAL_MS) {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    void runCloudSync();
  }, delayMs);
}

async function runCloudSync(): Promise<CloudSyncStatus> {
  const generation = cloudSyncGeneration;
  if (cloudSyncInFlight?.generation === generation) return cloudSyncInFlight.promise;
  const promise = runCloudSyncOnce(generation);
  cloudSyncInFlight = { generation, promise };
  promise.finally(() => {
    if (cloudSyncInFlight?.promise === promise) {
      cloudSyncInFlight = null;
    }
  });
  return promise;
}

async function runCloudSyncOnce(generation: number): Promise<CloudSyncStatus> {
  const summary = cloudSyncWorkspace;
  if (!summary?.path || !summary.cloudWorkspaceId) {
    if (cloudSyncGeneration === generation) {
      cloudSyncShowInEmptyState = false;
      return setCloudSyncStatus({ state: "idle" });
    }
    return { state: "idle" };
  }
  const run = {
    generation,
    workspacePath: summary.path,
    cloudWorkspaceId: summary.cloudWorkspaceId
  };

  const cwd = path.dirname(summary.path);
  const clientToken = cloudWorkspaceTokensByCwd.get(cwd);
  if (!clientToken) {
    return setCloudSyncStatusForRun(run, { state: "error", message: "Cloud workspace token is missing." });
  }

  try {
    setCloudSyncCheckingForRun(run);
    const status = await fetchJson<{
      ok: true;
      integrations: {
        gmail?: {
          connected: boolean;
          accountEmail?: string;
          lastSyncedAt?: string;
          sync?: {
            state?: string;
            errorMessage?: string;
            error_message?: string;
          };
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
    if (!isCurrentCloudSyncRun(run)) return cloudSyncStatus;

    const gmailStatus = status.integrations.gmail;
    const linkedInStatus = status.integrations.linkedin ?? status.integrations.linkedin_unipile;
    const gmailSyncState = gmailStatus?.sync?.state;
    const gmailSyncActive = gmailSyncState === "pending" || gmailSyncState === "running";
    const gmailSyncFailed = gmailSyncState === "failed";
    const gmailImportable = gmailStatus?.connected === true && gmailSyncState === "succeeded";
    const connectedProviders: CloudSyncProvider[] = [];
    const importableProviders: CloudSyncProvider[] = [];
    if (gmailStatus?.connected || gmailSyncActive || gmailSyncFailed) connectedProviders.push("gmail");
    if (linkedInStatus?.connected) connectedProviders.push("linkedin");
    if (gmailImportable) importableProviders.push("gmail");
    if (linkedInStatus?.connected) importableProviders.push("linkedin");

    if (connectedProviders.length === 0) {
      return setCloudSyncStatusForRun(run, { state: "disconnected" });
    }

    if (gmailSyncActive) {
      scheduleCloudSyncForRun(run, CLOUD_SYNC_ACTIVE_INTERVAL_MS);
      return setCloudSyncStatusForRun(run, {
        state: "syncing",
        providers: ["gmail"],
        showInEmptyState: cloudSyncShowInEmptyState
      });
    }
    if (gmailSyncFailed) {
      clearEmptyStateSyncForRun(run);
      return setCloudSyncStatusForRun(run, {
        state: "error",
        message: gmailStatus?.sync?.errorMessage ?? gmailStatus?.sync?.error_message ?? "Gmail sync failed."
      });
    }
    if (importableProviders.length === 0) {
      scheduleCloudSyncForRun(run);
      clearEmptyStateSyncForRun(run);
      return setCloudSyncStatusForRun(run, {
        state: "synced",
        lastSyncedAt: new Date().toISOString(),
        stats: {
          people_created: 0,
          communication_threads_created: 0,
          communication_messages_created: 0
        }
      });
    }

    setCloudSyncStatusForRun(run, {
      state: "syncing",
      providers: importableProviders,
      showInEmptyState: cloudSyncShowInEmptyState
    });
    const aggregateStats: CommunicationImportStats = {
      people_created: 0,
      communication_threads_created: 0,
      communication_messages_created: 0
    };

    if (gmailImportable) {
      if (!isCurrentCloudSyncRun(run)) return cloudSyncStatus;
      const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "gmail", {
        expectedWorkspacePath: summary.path
      });
      addCommunicationStats(aggregateStats, stats);
    }

    if (linkedInStatus?.connected) {
      if (!isCurrentCloudSyncRun(run)) return cloudSyncStatus;
      const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "linkedin", {
        ignoreMissingEndpoint: true,
        expectedWorkspacePath: summary.path
      });
      if (stats) {
        addCommunicationStats(aggregateStats, stats);
      }
    }

    if (isCurrentCloudSyncRun(run)) {
      sendToMainWindow("workspace:changed");
    }
    scheduleCloudSyncForRun(run);
    clearEmptyStateSyncForRun(run);
    return setCloudSyncStatusForRun(run, {
      state: "synced",
      lastSyncedAt: new Date().toISOString(),
      stats: aggregateStats
    });
  } catch (error) {
    clearEmptyStateSyncForRun(run);
    return setCloudSyncStatusForRun(run, {
      state: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function isDefaultRecordsWorkspaceEmpty(summary: WorkspaceSummary): boolean {
  return DEFAULT_EMPTY_RECORD_OBJECTS.every((objectSlug) =>
    (summary.counts[objectSlug] ?? 0) === 0
  );
}

async function importCloudCommunicationExport(
  workspaceId: string,
  clientToken: string,
  provider: "gmail" | "linkedin",
  options: { ignoreMissingEndpoint?: boolean; expectedWorkspacePath?: string } = {}
): Promise<CommunicationImportStats | undefined> {
  try {
    const exported = await fetchJson<{
      ok: true;
      data: unknown;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/export`, clientToken);
    const result = await getSdkClient().request<{
      stats?: Partial<CommunicationImportStats>;
    }>("importCommunicationBatch", exported.data, options.expectedWorkspacePath);
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

function numberField(source: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
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
    ...(accounts.length > 0 ? { accounts } : {}),
    ...normalizeIntegrationSync(source.sync)
  };
}

function normalizeIntegrationSync(value: unknown): Pick<IntegrationProviderStatus, "sync"> {
  const source = isRecord(value) ? value : {};
  const state = stringField(source, "state");
  if (
    state !== "idle" &&
    state !== "pending" &&
    state !== "running" &&
    state !== "succeeded" &&
    state !== "failed"
  ) {
    return {};
  }
  const peopleSeen = numberField(source, "peopleSeen", "people_seen");
  const communicationThreadsSeen = numberField(
    source,
    "communicationThreadsSeen",
    "communication_threads_seen"
  );
  const communicationMessagesSeen = numberField(
    source,
    "communicationMessagesSeen",
    "communication_messages_seen"
  );
  const startedAt = stringField(source, "startedAt", "started_at");
  const finishedAt = stringField(source, "finishedAt", "finished_at");
  const errorMessage = stringField(source, "errorMessage", "error_message");
  return {
    sync: {
      state,
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(peopleSeen != null ? { peopleSeen } : {}),
      ...(communicationThreadsSeen != null ? { communicationThreadsSeen } : {}),
      ...(communicationMessagesSeen != null ? { communicationMessagesSeen } : {})
    }
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

async function ensureAgentWorkspaceGuides(cwd: string): Promise<void> {
  await ensureAgentInstructionFilesInDir(cwd);
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

function safeDroppedFileName(name: string): string {
  const basename = path.basename(name || "dropped-file");
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "dropped-file";
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
  if (summary?.path) {
    workspaceWatcher.start(summary.path);
    app.addRecentDocument(summary.path);
    await recordRecentWorkspace(summary.path);
  }
  startCloudSync(summary);
  return summary;
}

function recentWorkspacesPath(): string {
  return path.join(app.getPath("userData"), RECENT_WORKSPACES_FILENAME);
}

function normalizeRecentWorkspace(input: unknown): PersistedRecentWorkspace | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Partial<PersistedRecentWorkspace>;
  if (typeof candidate.path !== "string" || !candidate.path.endsWith(".acrm")) return null;
  if (typeof candidate.openedAt !== "string" || Number.isNaN(new Date(candidate.openedAt).getTime())) {
    return null;
  }
  return {
    path: candidate.path,
    openedAt: candidate.openedAt
  };
}

async function readRecentWorkspaces(): Promise<PersistedRecentWorkspace[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(recentWorkspacesPath(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecentWorkspace).filter((item): item is PersistedRecentWorkspace => Boolean(item));
  } catch {
    return [];
  }
}

async function writeRecentWorkspaces(workspaces: PersistedRecentWorkspace[]): Promise<void> {
  const filePath = recentWorkspacesPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(workspaces, null, 2)}\n`);
}

async function recordRecentWorkspace(filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const next: PersistedRecentWorkspace = {
    path: resolvedPath,
    openedAt: new Date().toISOString()
  };
  const seen = new Set<string>();
  const workspaces = [next, ...await readRecentWorkspaces()]
    .filter((workspace) => {
      const key = path.resolve(workspace.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
  await writeRecentWorkspaces(workspaces);
}

async function findWorkspaceFiles(dir: string, depth: number): Promise<RecentWorkspaceSummary[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: RecentWorkspaceSummary[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) {
        files.push(...await findWorkspaceFiles(entryPath, depth - 1));
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".acrm")) continue;
    try {
      const stat = await fs.stat(entryPath);
      files.push({
        path: entryPath,
        filename: entry.name,
        lastOpenedAt: stat.mtime.toISOString(),
        timestampSource: "modified"
      });
    } catch {
      // Ignore files that disappear while scanning.
    }
  }
  return files;
}

async function listRecentWorkspaces(): Promise<RecentWorkspaceSummary[]> {
  const seen = new Set<string>();
  const isRecentWorkspace = (item: RecentWorkspaceSummary | null): item is RecentWorkspaceSummary =>
    item !== null;
  const persisted: Array<Promise<RecentWorkspaceSummary | null>> = (await readRecentWorkspaces()).map(async (workspace) => {
    try {
      await fs.stat(workspace.path);
      return {
        path: workspace.path,
        filename: path.basename(workspace.path),
        lastOpenedAt: workspace.openedAt,
        timestampSource: "opened" as const
      };
    } catch {
      return null;
    }
  });
  const recentDocuments: Array<Promise<RecentWorkspaceSummary | null>> = app.getRecentDocuments()
    .filter((filePath) => filePath.endsWith(".acrm"))
    .map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        return {
          path: filePath,
          filename: path.basename(filePath),
          lastOpenedAt: stat.mtime.toISOString(),
          timestampSource: "modified" as const
        };
      } catch {
        return null;
      }
    });

  const scanned = await Promise.all(RECENT_WORKSPACE_DIRS.map(({ dir, depth }) =>
    findWorkspaceFiles(dir, depth)
  ));

  return [
    ...(await Promise.all(persisted)).filter(isRecentWorkspace),
    ...(await Promise.all(recentDocuments)).filter(isRecentWorkspace),
    ...scanned.flat()
  ]
    .filter((workspace) => {
      const key = path.resolve(workspace.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
    .slice(0, 3);
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
  await ensureAgentInstructionFiles(filePath);
  if (summary?.path) {
    workspaceWatcher.start(summary.path);
    app.addRecentDocument(summary.path);
    await recordRecentWorkspace(summary.path);
  }
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
  if (
    !cloudSyncWorkspace ||
    cloudSyncWorkspace.path !== withCloud.path ||
    cloudSyncWorkspace.cloudWorkspaceId !== withCloud.cloudWorkspaceId
  ) {
    startCloudSync(withCloud);
  } else {
    updateCloudSyncWorkspace(withCloud);
  }
  return withCloud;
});
handle("workspace:list-recent", listRecentWorkspaces);
handle("records:list", (objectSlug: string, options?: RecordListOptions) => {
  return getSdkClient().request<RecordListResult>("listRecords", objectSlug, options);
});
handle("records:create", (payload: CreateRecordPayload) => {
  return getSdkClient().request("createRecord", payload);
});
handle("records:update", async (payload: UpdateRecordPayload) => {
  const result = await getSdkClient().request<UpdateRecordResult>("updateRecord", payload);
  sendToMainWindow("workspace:changed");
  return result;
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
    await Promise.all([
      ensureClaudeTrust(resolvedCwd),
      ensureAgentWorkspaceGuides(resolvedCwd)
    ]);
  } catch {
    // best-effort — don't block PTY spawn if agent setup writes fail
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

handle("pty:persist-dropped-file", async (payload: TerminalDroppedFilePayload) => {
  const bytes = payload.bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("Dropped file payload must include bytes.");
  }
  if (bytes.byteLength > MAX_DROPPED_FILE_BYTES) {
    throw new Error("Dropped file is too large.");
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-crm-drop-"));
  const filePath = path.join(dir, safeDroppedFileName(payload.name));
  await fs.writeFile(filePath, Buffer.from(bytes));
  return filePath;
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
