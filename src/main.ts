import { app, BrowserWindow, ipcMain, safeStorage, session as electronSession, shell } from "electron";
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
  AgentCliPreflightStatus,
  AuthSessionSummary,
  AuthRuntimeConfig,
  CloudIntegrationsStatus,
  GmailSyncProgress,
  CloudSyncStatus,
  CloudSyncProvider,
  CommunicationThreadMessagesResult,
  CompleteDesktopAuthPayload,
  CompanyTeamResult,
  CreateRecordPayload,
  ImportCsvPayload,
  IntegrationAccountSummary,
  IntegrationProviderStatus,
  IntegrationSyncStatus,
  PersonCompanyResult,
  PersonRelatedObject,
  PersonRelatedResult,
  RecordListOptions,
  RecordListResult,
  RecordLabelsResult,
  RecentWorkspaceSummary,
  SignalRunRequest,
  StartExternalAuthPayload,
  TerminalDroppedFilePayload,
  TranscriptImportResult,
  TranscriptPayload,
  UpdateDealPayload,
  UpdateDealResult,
  UpdateRecordPayload,
  UpdateRecordResult,
  UpdateStatus,
  WorkspaceSummary
} from "./shared/types.js";
import {
  TERMINAL_WORKSPACE_REFRESH_BURST_DURATION_MS,
  TERMINAL_WORKSPACE_REFRESH_BURST_INTERVAL_MS,
  TERMINAL_WORKSPACE_REFRESH_DELAY_MS,
  terminalOutputMayChangeWorkspace
} from "./workspace-refresh-heuristic.js";

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const devIconPath = path.join(__dirname, "../../build/icon.png");

let mainWindow: BrowserWindow | null = null;
let sdkClient: SdkServiceClient | null = null;
const cloudWorkspaceIdsByCwd = new Map<string, string>();
const cloudWorkspaceTokensByCwd = new Map<string, string>();
const cloudWorkspaceOrgIdsByCwd = new Map<string, string>();
const desktopSessionTokensByCwd = new Map<string, string>();
const databaseUrlsByCwd = new Map<string, string>();
const syncEngineUrl = process.env.AGENT_CRM_SYNC_ENGINE_URL ?? "https://agent-crm-sync-engine.onrender.com";
let cloudSyncStatus: CloudSyncStatus = { state: "idle" };
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let terminalWorkspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let terminalWorkspaceRefreshBurstUntil = 0;
let cloudSyncWorkspace: WorkspaceSummary | null = null;
let cloudSyncInFlight: { generation: number; promise: Promise<CloudSyncStatus> } | null = null;
let cloudSyncGeneration = 0;
let cloudSyncShowInEmptyState = false;
const CLOUD_SYNC_IDLE_INTERVAL_MS = 60_000;
const CLOUD_SYNC_ACTIVE_INTERVAL_MS = 5_000;
const AGENT_CLI_COMMAND_TIMEOUT_MS = 30 * 1000;
const AGENT_CLI_INSTALL_TIMEOUT_MS = 120 * 1000;
const GMAIL_PARTIAL_IMPORT_MIN_INTERVAL_MS = 15_000;
const GMAIL_PARTIAL_IMPORT_MIN_DELTA = 50;
const DEFAULT_EMPTY_RECORD_OBJECTS = ["companies", "people", "deals"] as const;
const RECORD_LABEL_BATCH_SIZE = 100;
const DESKTOP_SESSION_FILENAME = "desktop-session.bin";
const DESKTOP_SIGNED_OUT_FILENAME = "desktop-signed-out.json";
const DESKTOP_AUTH_PROTOCOL = "agent-crm";
const DESKTOP_AUTH_CALLBACK_HOST = "auth";
const DESKTOP_AUTH_CALLBACK_PATH = "/callback";
let currentDesktopSession: StoredDesktopSession | null = null;
const gmailPartialImportsByWorkspace = new Map<string, CommunicationPartialImportState>();
const gmailCompletedImportsByWorkspace = new Map<string, string>();
const linkedInPartialImportsByWorkspace = new Map<string, CommunicationPartialImportState>();
const linkedInCompletedImportsByWorkspace = new Map<string, string>();

type CommunicationImportStats = {
  people_created: number;
  communication_threads_created: number;
  communication_messages_created: number;
};

type CommunicationPartialImportState = {
  importedWrittenThreads: number;
  importedWrittenMessages: number;
  lastImportAtMs: number;
};

type CloudSyncRunContext = {
  generation: number;
  workspacePath: string;
  cloudWorkspaceId: string;
};

type StoredDesktopSession = AuthSessionSummary & {
  sessionToken: string;
};

class CloudAppRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "CloudAppRequestError";
  }
}

function sendToMainWindow(channel: string, ...args: unknown[]) {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

type RpcResponse<T> =
  | { id: number; result: T }
  | { id: number; error: { message: string; name?: string; stack?: string } };
type RpcEvent = { event: string; workspacePath?: string };

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
    let message: RpcResponse<unknown> | RpcEvent;
    try {
      message = JSON.parse(line) as RpcResponse<unknown> | RpcEvent;
    } catch {
      console.warn(`[sdk-service] ${line}`);
      return;
    }

    if ("event" in message) {
      if (message.event === "workspaceChanged") {
        sendToMainWindow("workspace:changed");
      }
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

function desktopSessionPath(): string {
  return path.join(app.getPath("userData"), DESKTOP_SESSION_FILENAME);
}

function desktopSignedOutPath(): string {
  return path.join(app.getPath("userData"), DESKTOP_SIGNED_OUT_FILENAME);
}

function devDesktopSessionPath(): string {
  return path.join(app.getPath("userData"), "desktop-session.dev.json");
}

function canUseDevPlaintextDesktopSession(): boolean {
  return isDev && process.env.AGENT_CRM_DEV_PLAINTEXT_SESSION !== "0";
}

async function readStoredDesktopSession(): Promise<StoredDesktopSession | null> {
  if (currentDesktopSession) {
    if (isExpiredStoredDesktopSession(currentDesktopSession)) {
      await discardStoredDesktopSession();
      return null;
    }
    return currentDesktopSession;
  }
  try {
    let parsed: StoredDesktopSession;
    if (canUseDevPlaintextDesktopSession()) {
      const rawSession = await fs.readFile(devDesktopSessionPath(), "utf8");
      try {
        parsed = JSON.parse(rawSession) as StoredDesktopSession;
      } catch {
        throw new Error("Failed to parse dev plaintext desktop session.");
      }
    } else {
      const encryptedSession = await fs.readFile(desktopSessionPath());
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Electron safeStorage encryption is not available.");
      }
      try {
        parsed = JSON.parse(safeStorage.decryptString(encryptedSession)) as StoredDesktopSession;
      } catch {
        throw new Error("Electron safeStorage desktop session decryption or parsing failed.");
      }
    }
    if (!parsed) {
      throw new Error("Stored desktop session payload was empty.");
    }
    if (!isStoredDesktopSession(parsed)) {
      await discardStoredDesktopSession();
      return null;
    }
    if (isExpiredStoredDesktopSession(parsed)) {
      await discardStoredDesktopSession();
      return null;
    }
    currentDesktopSession = parsed;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(`[auth] failed to read desktop session: ${error instanceof Error ? error.message : String(error)}`);
      await discardStoredDesktopSession();
    }
    return null;
  }
}

async function writeStoredDesktopSession(session: StoredDesktopSession): Promise<void> {
  const useDevPlaintextSession = canUseDevPlaintextDesktopSession();
  if (!useDevPlaintextSession && !safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage encryption is not available.");
  }
  const filePath = useDevPlaintextSession ? devDesktopSessionPath() : desktopSessionPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, useDevPlaintextSession
    ? JSON.stringify(session)
    : safeStorage.encryptString(JSON.stringify(session)));
  currentDesktopSession = session;
  await clearDesktopSignedOut();
}

async function revokeStoredDesktopSession(session: StoredDesktopSession): Promise<void> {
  try {
    await fetch(new URL("/auth/desktop-sessions/revoke", syncEngineUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        accept: "application/json"
      }
    });
  } catch (error) {
    console.warn(`[auth] failed to revoke desktop session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discardStoredDesktopSession(): Promise<void> {
  currentDesktopSession = null;
  desktopSessionTokensByCwd.clear();
  cloudWorkspaceOrgIdsByCwd.clear();
  stopCloudSync();
  await fs.rm(desktopSessionPath(), { force: true });
  await fs.rm(devDesktopSessionPath(), { force: true });
  sendToMainWindow("workspace:changed");
}

async function clearStoredDesktopSession(): Promise<void> {
  const session = await readStoredDesktopSession();
  if (session) await revokeStoredDesktopSession(session);
  await discardStoredDesktopSession();
}

async function hasDesktopSignedOut(): Promise<boolean> {
  try {
    await fs.access(desktopSignedOutPath());
    return true;
  } catch {
    return false;
  }
}

async function markDesktopSignedOut(): Promise<void> {
  const filePath = desktopSignedOutPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ signedOutAt: new Date().toISOString() }));
}

async function clearDesktopSignedOut(): Promise<void> {
  await fs.rm(desktopSignedOutPath(), { force: true });
}

async function clearElectronAuthStorage(): Promise<void> {
  try {
    const config = await fetchAuthRuntimeConfig();
    await electronSession.defaultSession.clearStorageData({
      origin: config.authUrl,
      storages: ["cookies", "localstorage", "indexdb"]
    });
    await electronSession.defaultSession.clearAuthCache();
  } catch (error) {
    console.warn(`[auth] failed to clear Electron auth storage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function authSessionSummary(session: StoredDesktopSession): AuthSessionSummary {
  return {
    expiresAt: session.expiresAt,
    user: session.user,
    workspace: session.workspace
  };
}

function isExpiredStoredDesktopSession(session: StoredDesktopSession): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function isStoredDesktopSession(value: unknown): value is StoredDesktopSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredDesktopSession>;
  return (
    typeof candidate.sessionToken === "string" &&
    typeof candidate.expiresAt === "string" &&
    Boolean(candidate.user && typeof candidate.user.userId === "string") &&
    Boolean(candidate.workspace &&
      typeof candidate.workspace.workspaceId === "string" &&
      typeof candidate.workspace.orgId === "string" &&
      typeof candidate.workspace.name === "string")
  );
}

async function redeemDesktopAuthCode(code: string): Promise<StoredDesktopSession> {
  const response = await fetch(new URL("/auth/desktop-sessions/redeem", syncEngineUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ code })
  });
  const payload = await response.json().catch(() => undefined) as
    | {
        ok?: unknown;
        session_token?: unknown;
        expires_at?: unknown;
        user?: { user_id?: unknown; email?: unknown };
        workspace?: { workspace_id?: unknown; org_id?: unknown; name?: unknown };
        error?: unknown;
      }
    | undefined;
  if (
    !response.ok ||
    payload?.ok !== true ||
    typeof payload.session_token !== "string" ||
    typeof payload.expires_at !== "string" ||
    typeof payload.user?.user_id !== "string" ||
    typeof payload.workspace?.workspace_id !== "string" ||
    typeof payload.workspace?.org_id !== "string" ||
    typeof payload.workspace?.name !== "string"
  ) {
    throw new Error(cloudSyncErrorMessage(payload, `Auth failed (${response.status})`));
  }
  const session: StoredDesktopSession = {
    sessionToken: payload.session_token,
    expiresAt: payload.expires_at,
    user: {
      userId: payload.user.user_id,
      ...(typeof payload.user.email === "string" ? { email: payload.user.email } : {})
    },
    workspace: {
      workspaceId: payload.workspace.workspace_id,
      orgId: payload.workspace.org_id,
      name: payload.workspace.name
    }
  };
  await writeStoredDesktopSession(session);
  sendToMainWindow("workspace:changed");
  return session;
}

async function fetchAuthRuntimeConfig(): Promise<AuthRuntimeConfig> {
  const runtimeConfigUrl = new URL("/auth/runtime-config", syncEngineUrl);
  try {
    const response = await fetch(runtimeConfigUrl, {
      headers: { accept: "application/json" }
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      const config = normalizeAuthRuntimeConfig(payload);
      if (config) return config;
    }
  } catch {
    // Older sync-engine deployments do not expose this JSON endpoint yet.
  }

  const response = await fetch(new URL("/auth/sign-in", syncEngineUrl), {
    headers: { accept: "text/html" }
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Could not load auth config (${response.status}).`);
  }
  const config = normalizeAuthRuntimeConfig(authRuntimeConfigFromHtml(html));
  if (!config) throw new Error("Could not read auth config from sync-engine.");
  return config;
}

function authRuntimeConfigFromHtml(html: string): unknown {
  const match = html.match(/window\.__AGENT_CRM_AUTH_CONFIG__=(\{.*?\});?<\/script>/s);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function normalizeAuthRuntimeConfig(input: unknown): AuthRuntimeConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.authUrl !== "string" || candidate.authUrl.trim().length === 0) {
    return null;
  }
  const authUrl = trimTrailingSlash(candidate.authUrl);
  const baseApiUrl = trimTrailingSlash(
    typeof candidate.baseApiUrl === "string" && candidate.baseApiUrl.trim().length > 0
      ? candidate.baseApiUrl
      : syncEngineUrl
  );
  return {
    authUrl,
    baseApiUrl,
    forgotPasswordUrl: typeof candidate.forgotPasswordUrl === "string" && candidate.forgotPasswordUrl.trim().length > 0
      ? candidate.forgotPasswordUrl
      : new URL("/forgot-password", `${authUrl}/`).toString()
  };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function desktopAuthCallbackUrl(): string {
  return `${DESKTOP_AUTH_PROTOCOL}://${DESKTOP_AUTH_CALLBACK_HOST}${DESKTOP_AUTH_CALLBACK_PATH}`;
}

async function buildExternalGoogleAuthUrl(config: AuthRuntimeConfig, route: "sign-in" | "sign-up"): Promise<string> {
  const authUrl = new URL(`/auth/${route}`, config.baseApiUrl);
  authUrl.searchParams.set("mode", "desktop");
  authUrl.searchParams.set("desktop_callback", desktopAuthCallbackUrl());
  if (!(await hasDesktopSignedOut())) {
    authUrl.searchParams.set("auto_google", "1");
  }
  return authUrl.toString();
}

async function startExternalAuth(payload: StartExternalAuthPayload): Promise<void> {
  if (payload?.provider !== "google" || (payload.route !== "sign-in" && payload.route !== "sign-up")) {
    throw new Error("External auth request is invalid.");
  }
  await shell.openExternal(await buildExternalGoogleAuthUrl(await fetchAuthRuntimeConfig(), payload.route));
}

function registerDesktopAuthProtocol(): void {
  if (isDev && process.argv[1]) {
    app.setAsDefaultProtocolClient(DESKTOP_AUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }
  app.setAsDefaultProtocolClient(DESKTOP_AUTH_PROTOCOL);
}

async function handleDesktopAuthCallbackUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (
    url.protocol !== `${DESKTOP_AUTH_PROTOCOL}:` ||
    url.hostname !== DESKTOP_AUTH_CALLBACK_HOST ||
    url.pathname !== DESKTOP_AUTH_CALLBACK_PATH
  ) {
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    console.warn("[auth] desktop callback was missing a code.");
    return;
  }

  try {
    await redeemDesktopAuthCode(code);
    mainWindow?.show();
    mainWindow?.focus();
  } catch (error) {
    console.error("[auth] desktop callback redemption failed", error);
    sendToMainWindow("workspace:changed");
  }
}

async function completeDesktopAuth(payload: CompleteDesktopAuthPayload): Promise<AuthSessionSummary> {
  if (
    !payload ||
    typeof payload.accessToken !== "string" ||
    typeof payload.orgId !== "string" ||
    payload.accessToken.trim().length === 0 ||
    payload.orgId.trim().length === 0
  ) {
    throw new Error("Desktop auth payload is invalid.");
  }

  const response = await fetch(new URL("/auth/desktop-sessions", syncEngineUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${payload.accessToken}`
    },
    body: JSON.stringify({
      org_id: payload.orgId,
      ...(payload.orgName ? { org_name: payload.orgName } : {})
    })
  });
  const body = await response.json().catch(() => undefined) as
    | { ok?: unknown; code?: unknown; error?: unknown }
    | undefined;
  if (!response.ok || body?.ok !== true || typeof body.code !== "string") {
    throw new Error(cloudSyncErrorMessage(body, `Desktop session setup failed (${response.status})`));
  }
  return authSessionSummary(await redeemDesktopAuthCode(body.code));
}

async function ensureCloudWorkspaceDir(session: StoredDesktopSession): Promise<string> {
  const dir = path.join(app.getPath("userData"), "cloud-workspaces", session.workspace.workspaceId);
  await fs.mkdir(dir, { recursive: true });
  cloudWorkspaceIdsByCwd.set(dir, session.workspace.workspaceId);
  cloudWorkspaceOrgIdsByCwd.set(dir, session.workspace.orgId);
  desktopSessionTokensByCwd.set(dir, session.sessionToken);
  return dir;
}

async function fetchAppJson<T>(pathname: string, session: StoredDesktopSession, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.sessionToken}`);
  headers.set("accept", "application/json");
  const response = await fetch(new URL(pathname, syncEngineUrl), {
    ...init,
    headers
  });
  const payload = await response.json().catch(() => undefined) as T | undefined;
  if (!response.ok) {
    throw new CloudAppRequestError(
      cloudSyncErrorMessage(payload, `Cloud app request failed (${response.status})`),
      response.status,
      payload
    );
  }
  if (!payload) throw new Error("Cloud app response was empty.");
  return payload;
}

async function getCloudWorkspaceFromSession(): Promise<WorkspaceSummary | null> {
  const session = await readStoredDesktopSession();
  if (!session) return null;
  let summary: WorkspaceSummary;
  try {
    summary = await fetchCloudWorkspaceSummaryFromSession(session);
  } catch (error) {
    if (error instanceof CloudAppRequestError && error.status === 401) {
      await discardStoredDesktopSession();
      return null;
    }
    throw error;
  }
  updateCurrentCloudWorkspace(summary);
  return summary;
}

async function fetchCloudWorkspaceSummaryFromSession(session: StoredDesktopSession): Promise<WorkspaceSummary> {
  const payload = await fetchAppJson<{ ok: true; workspace: WorkspaceSummary }>("/app/workspace", session);
  const dir = await ensureCloudWorkspaceDir(session);
  const summary: WorkspaceSummary = {
    ...payload.workspace,
    path: dir,
    filename: payload.workspace.filename ?? session.workspace.name,
    workspaceId: session.workspace.workspaceId,
    cloudWorkspaceId: session.workspace.workspaceId,
    orgId: session.workspace.orgId,
    user: session.user,
    org: {
      orgId: session.workspace.orgId
    }
  };
  return summary;
}

function updateCurrentCloudWorkspace(summary: WorkspaceSummary): void {
  if (
    !cloudSyncWorkspace ||
    cloudSyncWorkspace.path !== summary.path ||
    cloudSyncWorkspace.cloudWorkspaceId !== summary.cloudWorkspaceId
  ) {
    startCloudSync(summary);
  } else {
    updateCloudSyncWorkspace(summary);
  }
}

function workspaceRefreshFingerprint(summary: WorkspaceSummary | null): string {
  if (!summary) return "";
  return JSON.stringify({
    counts: Object.fromEntries(Object.entries(summary.counts ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    objects: (summary.objects ?? []).map((object) => ({
      object_slug: object.object_slug,
      singular_name: object.singular_name,
      plural_name: object.plural_name,
      attributes: object.attributes.map((attribute) => ({
        attribute_slug: attribute.attribute_slug,
        title: attribute.title,
        attribute_type: attribute.attribute_type,
        is_multivalued: attribute.is_multivalued,
        is_unique: attribute.is_unique,
        config: attribute.config
      }))
    }))
  });
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

type ShellCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

let agentCliPreflightStatus: AgentCliPreflightStatus = { state: "idle" };
let agentCliPreflightPromise: Promise<void> | null = null;

function publishAgentCliPreflightStatus(status: AgentCliPreflightStatus) {
  agentCliPreflightStatus = status;
  sendToMainWindow("agent-cli-preflight:status", status);
}

function shellCommandArgs(command: string): string[] {
  if (process.platform === "win32") return ["/d", "/s", "/c", command];
  return ["-ilc", command];
}

function runShellCommand(command: string, timeoutMs: number): Promise<ShellCommandResult> {
  const candidate = shellCandidates()[0];
  if (!candidate) {
    return Promise.reject(new Error("No usable shell was found."));
  }

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      TERM: process.env.TERM && process.env.TERM !== "dumb" ? process.env.TERM : "xterm-256color"
    };
    const child = spawn(candidate.command, shellCommandArgs(command), {
      cwd: defaultCwd(),
      env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

async function runSuccessfulShellCommand(command: string, timeoutMs: number): Promise<string> {
  const result = await runShellCommand(command, timeoutMs);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(detail || `Command failed with exit code ${result.exitCode}: ${command}`);
  }
  return result.stdout.trim();
}

function extractVersion(output: string): string | null {
  return output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/)?.[0] ?? null;
}

function compareSemverLike(left: string, right: string): number {
  const [leftCore, leftPrerelease = ""] = left.split("+")[0].split("-");
  const [rightCore, rightPrerelease = ""] = right.split("+")[0].split("-");
  const leftParts = leftCore.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = rightCore.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index++) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  if (!leftPrerelease && rightPrerelease) return 1;
  if (leftPrerelease && !rightPrerelease) return -1;
  return leftPrerelease.localeCompare(rightPrerelease);
}

async function isAgentCliInstalled(): Promise<boolean> {
  const command = process.platform === "win32" ? "where acrm" : "command -v acrm";
  const result = await runShellCommand(command, AGENT_CLI_COMMAND_TIMEOUT_MS);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function getInstalledAgentCliVersion(): Promise<string | null> {
  const result = await runShellCommand("acrm --version", AGENT_CLI_COMMAND_TIMEOUT_MS);
  if (result.exitCode !== 0) return null;
  return extractVersion(`${result.stdout}\n${result.stderr}`);
}

async function getLatestAgentCliVersion(): Promise<string> {
  const output = await runSuccessfulShellCommand(
    "npm view @agent-crm/cli version",
    AGENT_CLI_COMMAND_TIMEOUT_MS
  );
  const version = extractVersion(output);
  if (!version) throw new Error("Could not read the latest @agent-crm/cli version from npm.");
  return version;
}

async function installLatestAgentCli(): Promise<void> {
  await runSuccessfulShellCommand(
    "npm install -g @agent-crm/cli@latest",
    AGENT_CLI_INSTALL_TIMEOUT_MS
  );
}

async function runAgentCliPreflight(): Promise<void> {
  publishAgentCliPreflightStatus({ state: "checking" });
  const isInstalled = await isAgentCliInstalled();
  let currentVersion = isInstalled ? await getInstalledAgentCliVersion() : null;
  let latestVersion: string;
  let updated = false;

  if (!isInstalled) {
    publishAgentCliPreflightStatus({ state: "updating" });
    await installLatestAgentCli();
    updated = true;
    currentVersion = await getInstalledAgentCliVersion();
    if (!currentVersion) {
      throw new Error("@agent-crm/cli installed, but `acrm --version` is still unavailable.");
    }
    publishAgentCliPreflightStatus({
      state: "ready",
      version: currentVersion,
      updated
    });
    return;
  }

  try {
    latestVersion = await getLatestAgentCliVersion();
  } catch (error) {
    if (currentVersion) {
      publishAgentCliPreflightStatus({ state: "ready", version: currentVersion, updated: false });
      return;
    }
    throw error;
  }

  if (!currentVersion || compareSemverLike(currentVersion, latestVersion) < 0) {
    publishAgentCliPreflightStatus({
      state: "updating",
      ...(currentVersion ? { currentVersion } : {}),
      latestVersion
    });
    await installLatestAgentCli();
    updated = true;
    currentVersion = await getInstalledAgentCliVersion();
    if (!currentVersion) {
      throw new Error("@agent-crm/cli installed, but `acrm --version` is still unavailable.");
    }
  }

  publishAgentCliPreflightStatus({
    state: "ready",
    version: currentVersion,
    updated
  });
}

async function ensureAgentCliPreflight(): Promise<void> {
  if (!agentCliPreflightPromise) {
    agentCliPreflightPromise = runAgentCliPreflight().catch((error) => {
      publishAgentCliPreflightStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }).finally(() => {
      agentCliPreflightPromise = null;
    });
  }
  await agentCliPreflightPromise;
}

const AGENT_CRM_ROOT = path.join(os.homedir(), "agent-crm");
const CLOUD_METADATA_FILENAME = ".agent-crm-cloud.json";
const RECENT_WORKSPACES_FILENAME = "recent-workspaces.json";

type PersistedRecentWorkspace = {
  path: string;
  databaseUrl: string;
  name: string;
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
    "The Agent CRM desktop app checks and updates the installed `acrm` CLI before launching the embedded terminal.",
    "",
    "- Run `acrm --help` for current workspace guidance.",
    "<!-- agent-crm-app:end -->",
    "",
  ].join("\n")
} as const;

let agentWorkspaceInstructionsPromise: Promise<AgentWorkspaceInstructions> | null = null;

type CloudMetadata = {
  workspaceId?: string;
  clientToken?: string;
  orgId?: string;
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

function normalizeDatabaseUrl(input: string): string {
  const trimmed = input.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Workspace database URL must start with postgres:// or postgresql://.");
  }
  return trimmed;
}

function defaultWorkspaceName(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const dbName = parsed.pathname.replace(/^\/+/, "");
    return dbName || parsed.hostname || "Agent CRM";
  } catch {
    return "Agent CRM";
  }
}

function databaseUrlKey(databaseUrl: string): string {
  const parsed = new URL(normalizeDatabaseUrl(databaseUrl));
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

// Allocate a fresh workspace directory under the chosen parent keyed off the
// user's workspace name. The directory holds app-side files such as signals,
// caches, and agent instructions; CRM data lives in Postgres. If `<slug>` is
// taken, append `-2`, `-3`, etc. until we find a free one.
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

// The PTY runs in the workspace support directory so Claude Code sees the same
// signals and agent instructions as the Electron app. With no workspace open,
// fall back to the managed root.
function resolvePtyCwd(workspaceDir?: string): string {
  if (workspaceDir && workspaceDir.length > 0) {
    return workspaceDir;
  }
  return AGENT_CRM_ROOT;
}

async function withCloudWorkspace(summary: WorkspaceSummary): Promise<WorkspaceSummary> {
  if (!summary.path) return summary;
  const cwd = summary.path;
  const metadataPath = path.join(cwd, CLOUD_METADATA_FILENAME);
  const localWorkspaceId = await getSdkClient().request<string>("ensureWorkspaceIdentity");
  let metadata = await readCloudMetadata(metadataPath);

  if (metadata.workspaceId && metadata.clientToken) {
    if (metadata.localWorkspaceId && metadata.localWorkspaceId !== localWorkspaceId) {
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
    await fs.mkdir(cwd, { recursive: true });
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
  if (summary.databaseUrl) {
    databaseUrlsByCwd.set(cwd, summary.databaseUrl);
  }
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
      ...(typeof parsed.orgId === "string" && parsed.orgId.length > 0
        ? { orgId: parsed.orgId }
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
  if (terminalWorkspaceRefreshTimer) {
    clearTimeout(terminalWorkspaceRefreshTimer);
    terminalWorkspaceRefreshTimer = null;
  }
  terminalWorkspaceRefreshBurstUntil = 0;
  cloudSyncWorkspace = null;
  cloudSyncShowInEmptyState = false;
  gmailPartialImportsByWorkspace.clear();
  linkedInPartialImportsByWorkspace.clear();
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
  const desktopSession = await readStoredDesktopSession();
  if (desktopSession) {
    const integrations = await getCloudIntegrationsStatus();
    if (integrations.state !== "ready") {
      return setCloudSyncStatus(integrations.state === "error"
        ? { state: "error", message: integrations.message }
        : { state: "idle" });
    }
    try {
      const previousFingerprint = workspaceRefreshFingerprint(cloudSyncWorkspace);
      const summary = await fetchCloudWorkspaceSummaryFromSession(desktopSession);
      const nextFingerprint = workspaceRefreshFingerprint(summary);
      updateCurrentCloudWorkspace(summary);
      if (previousFingerprint && previousFingerprint !== nextFingerprint) {
        sendToMainWindow("workspace:changed");
      }
    } catch (error) {
      if (error instanceof CloudAppRequestError && error.status === 401) {
        await discardStoredDesktopSession();
        return setCloudSyncStatus({ state: "idle" });
      }
      console.warn(`[cloud-sync] failed to refresh cloud workspace summary: ${error instanceof Error ? error.message : String(error)}`);
    }
    const activeProviders: CloudSyncProvider[] = [];
    if (integrations.integrations.gmail.sync?.state === "running" || integrations.integrations.gmail.sync?.state === "pending") {
      activeProviders.push("gmail");
    }
    if (integrations.integrations.linkedin.sync?.state === "running" || integrations.integrations.linkedin.sync?.state === "pending") {
      activeProviders.push("linkedin");
    }
    if (activeProviders.length > 0) {
      scheduleCloudSync(CLOUD_SYNC_ACTIVE_INTERVAL_MS);
      return setCloudSyncStatus({ state: "syncing", providers: activeProviders });
    }
    if (!integrations.integrations.gmail.connected && !integrations.integrations.linkedin.connected && !integrations.integrations.granola.connected) {
      return setCloudSyncStatus({ state: "disconnected" });
    }
    scheduleCloudSync();
    return setCloudSyncStatus({
      state: "synced",
      lastSyncedAt: new Date().toISOString(),
      stats: {
        people_created: 0,
        communication_threads_created: 0,
        communication_messages_created: 0
      }
    });
  }

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

  const cwd = summary.path;
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
          last_synced_at?: string;
          sync?: {
            state?: string;
            errorMessage?: string;
            error_message?: string;
            peopleSeen?: number;
            people_seen?: number;
            communicationThreadsSeen?: number;
            communication_threads_seen?: number;
            communicationMessagesSeen?: number;
            communication_messages_seen?: number;
            backfillStatus?: string;
            backfill_status?: string;
            listedThreads?: number;
            listed_threads?: number;
            fetchedThreads?: number;
            fetched_threads?: number;
            filteredThreads?: number;
            filtered_threads?: number;
            writtenThreads?: number;
            written_threads?: number;
            writtenMessages?: number;
            written_messages?: number;
            pageCount?: number;
            page_count?: number;
            resultSizeEstimate?: number;
            result_size_estimate?: number;
            resumeAfter?: string;
            resume_after?: string;
          };
        };
        linkedin?: {
          connected: boolean;
          providerAccountId?: string;
          lastSyncedAt?: string;
          last_synced_at?: string;
          sync?: {
            state?: string;
            errorMessage?: string;
            error_message?: string;
            peopleSeen?: number;
            people_seen?: number;
            communicationThreadsSeen?: number;
            communication_threads_seen?: number;
            communicationMessagesSeen?: number;
            communication_messages_seen?: number;
            backfillStatus?: string;
            backfill_status?: string;
            writtenThreads?: number;
            written_threads?: number;
            writtenMessages?: number;
            written_messages?: number;
            pageCount?: number;
            page_count?: number;
          };
        };
        linkedin_unipile?: {
          connected: boolean;
          providerAccountId?: string;
          lastSyncedAt?: string;
          last_synced_at?: string;
          sync?: {
            state?: string;
            errorMessage?: string;
            error_message?: string;
            peopleSeen?: number;
            people_seen?: number;
            communicationThreadsSeen?: number;
            communication_threads_seen?: number;
            communicationMessagesSeen?: number;
            communication_messages_seen?: number;
            backfillStatus?: string;
            backfill_status?: string;
            writtenThreads?: number;
            written_threads?: number;
            writtenMessages?: number;
            written_messages?: number;
            pageCount?: number;
            page_count?: number;
          };
        };
      };
    }>(`/workspaces/${encodeURIComponent(summary.cloudWorkspaceId)}/integrations/status`, clientToken);
    if (!isCurrentCloudSyncRun(run)) return cloudSyncStatus;

    const gmailStatus = status.integrations.gmail;
    const linkedInStatus = status.integrations.linkedin ?? status.integrations.linkedin_unipile;
    const gmailSync = normalizeIntegrationSync(gmailStatus?.sync).sync;
    const linkedInSync = normalizeIntegrationSync(linkedInStatus?.sync).sync;
    const gmailSyncState = gmailSync?.state;
    const linkedInSyncState = linkedInSync?.state;
    const gmailLastSyncedAt = gmailStatus?.lastSyncedAt ?? gmailStatus?.last_synced_at;
    const linkedInLastSyncedAt = linkedInStatus?.lastSyncedAt ?? linkedInStatus?.last_synced_at;
    const gmailSyncActive = gmailSyncState === "pending" || gmailSyncState === "running";
    const linkedInSyncActive = linkedInSyncState === "pending" || linkedInSyncState === "running";
    const gmailSyncFailed = gmailSyncState === "failed";
    const linkedInSyncFailed = linkedInSyncState === "failed";
    const gmailImportable =
      gmailStatus?.connected === true &&
      gmailSyncState === "succeeded" &&
      !hasCompletedGmailImported(summary.cloudWorkspaceId, gmailSync, gmailLastSyncedAt);
    const linkedInImportable =
      linkedInStatus?.connected === true &&
      linkedInSyncState === "succeeded" &&
      !hasCompletedLinkedInImported(summary.cloudWorkspaceId, linkedInSync, linkedInLastSyncedAt);
    const connectedProviders: CloudSyncProvider[] = [];
    const importableProviders: CloudSyncProvider[] = [];
    if (gmailStatus?.connected || gmailSyncActive || gmailSyncFailed) connectedProviders.push("gmail");
    if (linkedInStatus?.connected || linkedInSyncActive || linkedInSyncFailed) connectedProviders.push("linkedin");
    if (gmailImportable) importableProviders.push("gmail");
    if (linkedInImportable) importableProviders.push("linkedin");

    if (connectedProviders.length === 0) {
      return setCloudSyncStatusForRun(run, { state: "disconnected" });
    }

    if (gmailSyncActive || linkedInSyncActive) {
      const providers: CloudSyncProvider[] = [];
      if (gmailSyncActive) providers.push("gmail");
      if (linkedInSyncActive) providers.push("linkedin");
      const progress = gmailSyncActive ? gmailSyncProgress(gmailSync) : linkedInSyncProgress(linkedInSync);
      const syncingStatus: CloudSyncStatus = {
        state: "syncing",
        providers,
        showInEmptyState: cloudSyncShowInEmptyState,
        ...(progress ? { progress } : {})
      };
      setCloudSyncStatusForRun(run, syncingStatus);

      if (gmailSyncState === "running" && shouldImportPartialGmail(summary.cloudWorkspaceId, gmailSync)) {
        try {
          const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "gmail", {
            expectedWorkspacePath: summary.path,
            partial: true
          });
          markPartialGmailImported(summary.cloudWorkspaceId, gmailSync);
          if (isCurrentCloudSyncRun(run) && stats) {
            sendToMainWindow("workspace:changed");
          }
        } catch (error) {
          console.warn(`[cloud-sync] partial Gmail import failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (linkedInSyncState === "running" && shouldImportPartialLinkedIn(summary.cloudWorkspaceId, linkedInSync)) {
        try {
          const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "linkedin", {
            expectedWorkspacePath: summary.path,
            partial: true
          });
          markPartialLinkedInImported(summary.cloudWorkspaceId, linkedInSync);
          if (isCurrentCloudSyncRun(run) && stats) {
            sendToMainWindow("workspace:changed");
          }
        } catch (error) {
          console.warn(`[cloud-sync] partial LinkedIn import failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      scheduleCloudSyncForRun(run, CLOUD_SYNC_ACTIVE_INTERVAL_MS);
      return cloudSyncStatus;
    }
    if (gmailSyncFailed) {
      clearEmptyStateSyncForRun(run);
      return setCloudSyncStatusForRun(run, {
        state: "error",
        message: gmailSync?.errorMessage ?? "Gmail sync failed."
      });
    }
    if (linkedInSyncFailed) {
      clearEmptyStateSyncForRun(run);
      return setCloudSyncStatusForRun(run, {
        state: "error",
        message: linkedInSync?.errorMessage ?? "LinkedIn sync failed."
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

    setCloudSyncStatusForRun(run, { state: "checking" });
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
      markPartialGmailImported(summary.cloudWorkspaceId, gmailSync);
      markCompletedGmailImported(summary.cloudWorkspaceId, gmailSync, gmailLastSyncedAt);
    }

    if (linkedInImportable) {
      if (!isCurrentCloudSyncRun(run)) return cloudSyncStatus;
      const stats = await importCloudCommunicationExport(summary.cloudWorkspaceId, clientToken, "linkedin", {
        expectedWorkspacePath: summary.path
      });
      if (stats) {
        addCommunicationStats(aggregateStats, stats);
      }
      markPartialLinkedInImported(summary.cloudWorkspaceId, linkedInSync);
      markCompletedLinkedInImported(summary.cloudWorkspaceId, linkedInSync, linkedInLastSyncedAt);
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

function gmailSyncProgress(sync: IntegrationSyncStatus | undefined): GmailSyncProgress | undefined {
  if (!sync) return undefined;
  const progress: GmailSyncProgress = {
    ...(sync.backfillStatus ? { backfillStatus: sync.backfillStatus } : {}),
    ...(sync.listedThreads != null ? { listedThreads: sync.listedThreads } : {}),
    ...(sync.fetchedThreads != null ? { fetchedThreads: sync.fetchedThreads } : {}),
    ...(sync.filteredThreads != null ? { filteredThreads: sync.filteredThreads } : {}),
    ...(sync.writtenThreads != null ? { writtenThreads: sync.writtenThreads } : {}),
    ...(sync.writtenMessages != null ? { writtenMessages: sync.writtenMessages } : {}),
    ...(sync.pageCount != null ? { pageCount: sync.pageCount } : {}),
    ...(sync.resultSizeEstimate != null ? { resultSizeEstimate: sync.resultSizeEstimate } : {}),
    ...(sync.resumeAfter ? { resumeAfter: sync.resumeAfter } : {})
  };
  return Object.keys(progress).length > 0 ? progress : undefined;
}

function linkedInSyncProgress(sync: IntegrationSyncStatus | undefined): GmailSyncProgress | undefined {
  if (!sync) return undefined;
  const progress: GmailSyncProgress = {
    ...(sync.backfillStatus ? { backfillStatus: sync.backfillStatus } : {}),
    ...(sync.writtenThreads != null ? { writtenThreads: sync.writtenThreads } : {}),
    ...(sync.writtenMessages != null ? { writtenMessages: sync.writtenMessages } : {}),
    ...(sync.communicationThreadsSeen != null ? { filteredThreads: sync.communicationThreadsSeen } : {}),
    ...(sync.communicationMessagesSeen != null ? { fetchedThreads: sync.communicationMessagesSeen } : {}),
    ...(sync.pageCount != null ? { pageCount: sync.pageCount } : {})
  };
  return Object.keys(progress).length > 0 ? progress : undefined;
}

function shouldImportPartialGmail(workspaceId: string, sync: IntegrationSyncStatus | undefined): boolean {
  if (!sync) return false;
  const writtenThreads = sync.writtenThreads ?? sync.communicationThreadsSeen ?? 0;
  const writtenMessages = sync.writtenMessages ?? sync.communicationMessagesSeen ?? 0;
  if (writtenThreads <= 0 && writtenMessages <= 0) return false;

  const previous = gmailPartialImportsByWorkspace.get(workspaceId);
  if (!previous) return true;
  if (
    writtenThreads < previous.importedWrittenThreads ||
    writtenMessages < previous.importedWrittenMessages
  ) {
    return true;
  }
  if (
    writtenThreads === previous.importedWrittenThreads &&
    writtenMessages === previous.importedWrittenMessages
  ) {
    return false;
  }

  const threadDelta = writtenThreads - previous.importedWrittenThreads;
  const messageDelta = writtenMessages - previous.importedWrittenMessages;
  return (
    threadDelta >= GMAIL_PARTIAL_IMPORT_MIN_DELTA ||
    messageDelta >= GMAIL_PARTIAL_IMPORT_MIN_DELTA ||
    Date.now() - previous.lastImportAtMs >= GMAIL_PARTIAL_IMPORT_MIN_INTERVAL_MS
  );
}

function markPartialGmailImported(workspaceId: string, sync: IntegrationSyncStatus | undefined): void {
  if (!sync) return;
  gmailPartialImportsByWorkspace.set(workspaceId, {
    importedWrittenThreads: sync.writtenThreads ?? sync.communicationThreadsSeen ?? 0,
    importedWrittenMessages: sync.writtenMessages ?? sync.communicationMessagesSeen ?? 0,
    lastImportAtMs: Date.now()
  });
}

function hasCompletedGmailImported(
  workspaceId: string,
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): boolean {
  const fingerprint = gmailCompletedSyncFingerprint(sync, lastSyncedAt);
  return fingerprint != null && gmailCompletedImportsByWorkspace.get(workspaceId) === fingerprint;
}

function markCompletedGmailImported(
  workspaceId: string,
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): void {
  const fingerprint = gmailCompletedSyncFingerprint(sync, lastSyncedAt);
  if (!fingerprint) return;
  gmailCompletedImportsByWorkspace.set(workspaceId, fingerprint);
}

function shouldImportPartialLinkedIn(workspaceId: string, sync: IntegrationSyncStatus | undefined): boolean {
  if (!sync) return false;
  const writtenThreads = sync.writtenThreads ?? sync.communicationThreadsSeen ?? 0;
  const writtenMessages = sync.writtenMessages ?? sync.communicationMessagesSeen ?? 0;
  if (writtenThreads <= 0 && writtenMessages <= 0) return false;

  const previous = linkedInPartialImportsByWorkspace.get(workspaceId);
  if (!previous) return true;
  if (
    writtenThreads < previous.importedWrittenThreads ||
    writtenMessages < previous.importedWrittenMessages
  ) {
    return true;
  }
  if (
    writtenThreads === previous.importedWrittenThreads &&
    writtenMessages === previous.importedWrittenMessages
  ) {
    return false;
  }

  const threadDelta = writtenThreads - previous.importedWrittenThreads;
  const messageDelta = writtenMessages - previous.importedWrittenMessages;
  return (
    threadDelta >= GMAIL_PARTIAL_IMPORT_MIN_DELTA ||
    messageDelta >= GMAIL_PARTIAL_IMPORT_MIN_DELTA ||
    Date.now() - previous.lastImportAtMs >= GMAIL_PARTIAL_IMPORT_MIN_INTERVAL_MS
  );
}

function markPartialLinkedInImported(workspaceId: string, sync: IntegrationSyncStatus | undefined): void {
  if (!sync) return;
  linkedInPartialImportsByWorkspace.set(workspaceId, {
    importedWrittenThreads: sync.writtenThreads ?? sync.communicationThreadsSeen ?? 0,
    importedWrittenMessages: sync.writtenMessages ?? sync.communicationMessagesSeen ?? 0,
    lastImportAtMs: Date.now()
  });
}

function hasCompletedLinkedInImported(
  workspaceId: string,
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): boolean {
  const fingerprint = linkedInCompletedSyncFingerprint(sync, lastSyncedAt);
  return fingerprint != null && linkedInCompletedImportsByWorkspace.get(workspaceId) === fingerprint;
}

function markCompletedLinkedInImported(
  workspaceId: string,
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): void {
  const fingerprint = linkedInCompletedSyncFingerprint(sync, lastSyncedAt);
  if (!fingerprint) return;
  linkedInCompletedImportsByWorkspace.set(workspaceId, fingerprint);
}

function gmailCompletedSyncFingerprint(
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): string | null {
  if (!sync || sync.state !== "succeeded") return null;
  const fingerprint = {
    lastSyncedAt,
    startedAt: sync.startedAt,
    finishedAt: sync.finishedAt,
    peopleSeen: sync.peopleSeen,
    communicationThreadsSeen: sync.communicationThreadsSeen,
    communicationMessagesSeen: sync.communicationMessagesSeen,
    writtenThreads: sync.writtenThreads,
    writtenMessages: sync.writtenMessages
  };
  if (Object.values(fingerprint).every((value) => value == null || value === "")) return null;
  return JSON.stringify(fingerprint);
}

function linkedInCompletedSyncFingerprint(
  sync: IntegrationSyncStatus | undefined,
  lastSyncedAt: string | undefined
): string | null {
  if (!sync || sync.state !== "succeeded") return null;
  const fingerprint = {
    lastSyncedAt,
    startedAt: sync.startedAt,
    finishedAt: sync.finishedAt,
    peopleSeen: sync.peopleSeen,
    communicationThreadsSeen: sync.communicationThreadsSeen,
    communicationMessagesSeen: sync.communicationMessagesSeen,
    writtenThreads: sync.writtenThreads,
    writtenMessages: sync.writtenMessages
  };
  if (Object.values(fingerprint).every((value) => value == null || value === "")) return null;
  return JSON.stringify(fingerprint);
}

async function importCloudCommunicationExport(
  workspaceId: string,
  clientToken: string,
  provider: "gmail" | "linkedin",
  options: { ignoreMissingEndpoint?: boolean; expectedWorkspacePath?: string; partial?: boolean } = {}
): Promise<CommunicationImportStats | undefined> {
  try {
    const exportPath = `/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/export${options.partial ? "?mode=partial" : ""}`;
    const exported = await fetchJson<{
      ok: true;
      data: unknown;
    }>(exportPath, clientToken);
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
    throw new Error(cloudSyncErrorMessage(payload, `Cloud sync request failed (${response.status})`));
  }
  if (!payload) throw new Error("Cloud sync response was empty.");
  return payload;
}

function cloudSyncErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || !("error" in payload)) return fallback;
  const error = payload.error;
  if (typeof error === "string" && error.length > 0) return error;
  if (isRecord(error)) {
    const message = stringField(error, "message");
    if (message) return message;
    const code = stringField(error, "code");
    if (code) return code;
  }
  return fallback;
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
  const backfillStatus = stringField(source, "backfillStatus", "backfill_status");
  const listedThreads = numberField(source, "listedThreads", "listed_threads");
  const fetchedThreads = numberField(source, "fetchedThreads", "fetched_threads");
  const filteredThreads = numberField(source, "filteredThreads", "filtered_threads");
  const writtenThreads = numberField(source, "writtenThreads", "written_threads");
  const writtenMessages = numberField(source, "writtenMessages", "written_messages");
  const pageCount = numberField(source, "pageCount", "page_count");
  const resultSizeEstimate = numberField(source, "resultSizeEstimate", "result_size_estimate");
  const resumeAfter = stringField(source, "resumeAfter", "resume_after");
  return {
    sync: {
      state,
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(peopleSeen != null ? { peopleSeen } : {}),
      ...(communicationThreadsSeen != null ? { communicationThreadsSeen } : {}),
      ...(communicationMessagesSeen != null ? { communicationMessagesSeen } : {}),
      ...(backfillStatus ? { backfillStatus } : {}),
      ...(listedThreads != null ? { listedThreads } : {}),
      ...(fetchedThreads != null ? { fetchedThreads } : {}),
      ...(filteredThreads != null ? { filteredThreads } : {}),
      ...(writtenThreads != null ? { writtenThreads } : {}),
      ...(writtenMessages != null ? { writtenMessages } : {}),
      ...(pageCount != null ? { pageCount } : {}),
      ...(resultSizeEstimate != null ? { resultSizeEstimate } : {}),
      ...(resumeAfter ? { resumeAfter } : {})
    }
  };
}

async function getCloudIntegrationsStatus(): Promise<CloudIntegrationsStatus> {
  const desktopSession = await readStoredDesktopSession();
  if (desktopSession) {
    try {
      const status = await fetchAppJson<{
        ok: true;
        integrations?: Record<string, unknown>;
      }>(`/workspaces/${encodeURIComponent(desktopSession.workspace.workspaceId)}/integrations/status`, desktopSession);
      const integrations = isRecord(status.integrations) ? status.integrations : {};
      return {
        state: "ready",
        workspaceId: desktopSession.workspace.workspaceId,
        integrations: {
          gmail: normalizeIntegrationProvider(integrations.gmail),
          linkedin: normalizeIntegrationProvider(
            integrations.linkedin ?? integrations.linkedIn ?? integrations.linkedin_unipile
          ),
          granola: normalizeIntegrationProvider(integrations.granola)
        }
      };
    } catch (error) {
      if (error instanceof CloudAppRequestError && error.status === 401) {
        await discardStoredDesktopSession();
        return { state: "no_workspace" };
      }
      return {
        state: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const current = cloudSyncWorkspace
    ?? await getSdkClient().request<WorkspaceSummary | null>("getWorkspace");
  if (!current?.path) return { state: "no_workspace" };

  const summary = current.cloudWorkspaceId ? current : await withCloudWorkspace(current);
  if (!summary.cloudWorkspaceId) return { state: "no_workspace" };

  const cwd = summary.path;
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
        ),
        granola: normalizeIntegrationProvider(integrations.granola)
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

function scheduleWorkspaceRefreshFromPty(session: PtySession): void {
  if (
    !desktopSessionTokensByCwd.has(session.cwd) &&
    !cloudWorkspaceIdsByCwd.has(session.cwd) &&
    !databaseUrlsByCwd.has(session.cwd)
  ) {
    return;
  }

  const recentOutput = session.buffer.slice(-4096);
  if (!terminalOutputMayChangeWorkspace(recentOutput)) return;

  terminalWorkspaceRefreshBurstUntil = Math.max(
    terminalWorkspaceRefreshBurstUntil,
    Date.now() + TERMINAL_WORKSPACE_REFRESH_BURST_DURATION_MS
  );
  if (!terminalWorkspaceRefreshTimer) {
    scheduleTerminalWorkspaceRefreshPoll(TERMINAL_WORKSPACE_REFRESH_DELAY_MS);
  }
}

function scheduleTerminalWorkspaceRefreshPoll(delayMs: number): void {
  terminalWorkspaceRefreshTimer = setTimeout(() => {
    terminalWorkspaceRefreshTimer = null;
    void runCloudSync()
      .catch((error) => {
        console.warn(`[cloud-sync] terminal-triggered refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (Date.now() < terminalWorkspaceRefreshBurstUntil) {
          scheduleTerminalWorkspaceRefreshPoll(TERMINAL_WORKSPACE_REFRESH_BURST_INTERVAL_MS);
        } else {
          terminalWorkspaceRefreshBurstUntil = 0;
        }
      });
  }, delayMs);
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
  const cloudOrgId = cloudWorkspaceOrgIdsByCwd.get(cwd);
  if (cloudOrgId) {
    env.ACRM_CLOUD_ORG_ID = cloudOrgId;
  }
  const desktopSessionToken = desktopSessionTokensByCwd.get(cwd);
  if (desktopSessionToken) {
    env.ACRM_DESKTOP_SESSION_TOKEN = desktopSessionToken;
  }
  const cloudWorkspaceClientToken = cloudWorkspaceTokensByCwd.get(cwd);
  if (cloudWorkspaceClientToken) {
    env.ACRM_CLOUD_WORKSPACE_CLIENT_TOKEN = cloudWorkspaceClientToken;
  }
  const databaseUrl = desktopSessionToken ? undefined : databaseUrlsByCwd.get(cwd);
  if (desktopSessionToken) {
    delete env.ACRM_DATABASE_URL;
    delete env.NEON_DATABASE_URL;
    delete env.SUPABASE_DATABASE_URL;
    delete env.DATABASE_URL;
  }
  if (databaseUrl) {
    env.ACRM_DATABASE_URL = databaseUrl;
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
    scheduleWorkspaceRefreshFromPty(session);
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

function recentWorkspacesPath(): string {
  return path.join(app.getPath("userData"), RECENT_WORKSPACES_FILENAME);
}

function normalizeRecentWorkspace(input: unknown): PersistedRecentWorkspace | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Partial<PersistedRecentWorkspace>;
  if (typeof candidate.path !== "string" || candidate.path.length === 0) return null;
  if (typeof candidate.databaseUrl !== "string" || candidate.databaseUrl.length === 0) return null;
  try {
    normalizeDatabaseUrl(candidate.databaseUrl);
  } catch {
    return null;
  }
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  if (typeof candidate.openedAt !== "string" || Number.isNaN(new Date(candidate.openedAt).getTime())) {
    return null;
  }
  return {
    path: candidate.path,
    databaseUrl: candidate.databaseUrl,
    name: candidate.name,
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

async function recordRecentWorkspace(summary: WorkspaceSummary): Promise<void> {
  if (!summary.databaseUrl) return;
  const next: PersistedRecentWorkspace = {
    path: path.resolve(summary.path),
    databaseUrl: summary.databaseUrl,
    name: summary.filename,
    openedAt: new Date().toISOString()
  };
  const seen = new Set<string>();
  const workspaces = [next, ...await readRecentWorkspaces()]
    .filter((workspace) => {
      const key = databaseUrlKey(workspace.databaseUrl);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
  await writeRecentWorkspaces(workspaces);
}

async function listRecentWorkspaces(): Promise<RecentWorkspaceSummary[]> {
  const seen = new Set<string>();
  const enrichCounts = async (workspace: RecentWorkspaceSummary): Promise<RecentWorkspaceSummary> => {
    try {
      const summary = await getSdkClient().request<Pick<WorkspaceSummary, "counts">>(
        "summarizeWorkspace",
        workspace.databaseUrl
      );
      return { ...workspace, counts: summary.counts };
    } catch {
      return workspace;
    }
  };
  const workspaces = (await readRecentWorkspaces()).map((workspace) => ({
    path: workspace.path,
    databaseUrl: workspace.databaseUrl,
    filename: workspace.name,
    lastOpenedAt: workspace.openedAt,
    timestampSource: "opened" as const
  }))
    .filter((workspace) => {
      const key = databaseUrlKey(workspace.databaseUrl);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
    .slice(0, 3);
  return Promise.all(workspaces.map(enrichCounts));
}

async function workspaceDirForDatabase(databaseUrl: string, preferredName?: string): Promise<{ dir: string; name: string }> {
  const normalizedUrl = normalizeDatabaseUrl(databaseUrl);
  const key = databaseUrlKey(normalizedUrl);
  const existing = (await readRecentWorkspaces()).find((workspace) =>
    databaseUrlKey(workspace.databaseUrl) === key
  );
  if (existing) {
    return { dir: existing.path, name: existing.name };
  }
  const name = (preferredName?.trim() || defaultWorkspaceName(normalizedUrl)).slice(0, 60);
  const slug = slugifyWorkspaceName(name) || "workspace";
  return { dir: await allocateWorkspaceDir(slug), name };
}

async function openDatabaseWorkspace(databaseUrl: string, preferredName?: string): Promise<WorkspaceSummary> {
  const normalizedUrl = normalizeDatabaseUrl(databaseUrl);
  const { dir, name } = await workspaceDirForDatabase(normalizedUrl, preferredName);
  await fs.mkdir(dir, { recursive: true });
  const summary = await withCloudWorkspace(
    await getSdkClient().request<WorkspaceSummary>("openWorkspace", {
      databaseUrl: normalizedUrl,
      workspaceDir: dir,
      name
    })
  );
  await ensureAgentInstructionFilesInDir(summary.path);
  await recordRecentWorkspace(summary);
  startCloudSync(summary);
  return summary;
}

handle("workspace:open", async (databaseUrl: string) => {
  return openDatabaseWorkspace(databaseUrl);
});

handle("workspace:create", async (name: string, databaseUrl: string) => {
  const slug = slugifyWorkspaceName(name ?? "");
  if (slug.length === 0) {
    throw new Error("Workspace name must include at least one letter or number.");
  }
  const normalizedUrl = normalizeDatabaseUrl(databaseUrl);
  const { dir, name: workspaceName } = await workspaceDirForDatabase(normalizedUrl, name);
  const summary = await withCloudWorkspace(
    await getSdkClient().request<WorkspaceSummary>("createWorkspace", {
      databaseUrl: normalizedUrl,
      workspaceDir: dir,
      name: workspaceName
    })
  );
  await ensureAgentInstructionFilesInDir(summary.path);
  await recordRecentWorkspace(summary);
  startCloudSync(summary);
  return summary;
});
handle("workspace:close", async () => {
  stopCloudSync();
  await getSdkClient().request<void>("closeWorkspace");
});
handle("workspace:get", async () => {
  const cloudSummary = await getCloudWorkspaceFromSession();
  if (cloudSummary) return cloudSummary;
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
handle("workspace:list-recent", async () => {
  const session = await readStoredDesktopSession();
  return session ? [] : listRecentWorkspaces();
});
handle("records:list", async (objectSlug: string, options?: RecordListOptions) => {
  const session = await readStoredDesktopSession();
  if (session) {
    const url = new URL("/app/workspace/records", syncEngineUrl);
    url.searchParams.set("object_slug", objectSlug);
    if (options?.limit) url.searchParams.set("limit", String(options.limit));
    if (options?.cursor) url.searchParams.set("cursor", options.cursor);
    if (options?.valueAttributes?.length) url.searchParams.set("value_attributes", options.valueAttributes.join(","));
    if (options?.includeSecondaryLabels != null) {
      url.searchParams.set("include_secondary_labels", String(options.includeSecondaryLabels));
    }
    if (options?.searchQuery) url.searchParams.set("search_query", options.searchQuery);
    const payload = await fetchAppJson<{ ok: true } & RecordListResult>(url.pathname + url.search, session);
    return {
      objectSlug: payload.objectSlug,
      records: payload.records,
      limit: payload.limit,
      cursor: payload.cursor,
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      ...(payload.totalMatches != null ? { totalMatches: payload.totalMatches } : {})
    };
  }
  return getSdkClient().request<RecordListResult>("listRecords", objectSlug, options);
});
handle("records:create", async (payload: CreateRecordPayload) => {
  if (await readStoredDesktopSession()) {
    throw new Error("Creating records in the cloud desktop workspace is not implemented yet.");
  }
  const result = await getSdkClient().request("createRecord", payload);
  sendToMainWindow("workspace:changed");
  return result;
});
handle("records:update", async (payload: UpdateRecordPayload) => {
  const session = await readStoredDesktopSession();
  if (session) {
    const result = await fetchAppJson<UpdateRecordResult & { ok?: true }>(
      `/app/workspace/records/${encodeURIComponent(payload.object_slug)}/${encodeURIComponent(payload.record_id)}`,
      session,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: payload.fields,
          source: payload.source
        })
      }
    );
    sendToMainWindow("workspace:changed");
    return result;
  }
  const result = await getSdkClient().request<UpdateRecordResult>("updateRecord", payload);
  sendToMainWindow("workspace:changed");
  return result;
});
handle("deals:update", async (payload: UpdateDealPayload) => {
  const session = await readStoredDesktopSession();
  if (session) {
    const result = await fetchAppJson<UpdateDealResult & { ok?: true }>(
      `/app/workspace/deals/${encodeURIComponent(payload.record_id)}`,
      session,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
          source: payload.source
        })
      }
    );
    sendToMainWindow("workspace:changed");
    return result;
  }
  const fields = [
    ...(payload.stage !== undefined ? [`stage=${payload.stage}`] : [])
  ];
  const result = await getSdkClient().request<UpdateRecordResult>("updateRecord", {
    object_slug: "deals",
    record_id: payload.record_id,
    fields,
    source: payload.source
  });
  sendToMainWindow("workspace:changed");
  return { updated: result.updated, deal: { object_slug: "deals", record_id: result.record_id } };
});
handle("import:csv", async (payload: ImportCsvPayload) => {
  if (await readStoredDesktopSession()) {
    throw new Error("CSV import in the cloud desktop workspace is not implemented yet.");
  }
  const result = await getSdkClient().request("importCsv", payload);
  sendToMainWindow("workspace:changed");
  return result;
});
handle("import:transcript", async (payload: TranscriptPayload) => {
  if (await readStoredDesktopSession()) {
    throw new Error("Transcript import in the cloud desktop workspace is not implemented yet.");
  }
  const result = await getSdkClient().request<TranscriptImportResult>("importTranscript", payload);
  sendToMainWindow("workspace:changed");
  return result;
});
handle("people:related", async (personRecordId: string, object: PersonRelatedObject) => {
  const session = await readStoredDesktopSession();
  if (session) {
    const path = `/v1/people/${encodeURIComponent(personRecordId)}/related?object=${encodeURIComponent(object)}`;
    return fetchAppJson<PersonRelatedResult & { ok?: true }>(path, session);
  }
  return getSdkClient().request<PersonRelatedResult>("getPersonRelated", personRecordId, object);
});
handle("companies:team", async (companyRecordId: string) => {
  const session = await readStoredDesktopSession();
  if (session) {
    return fetchAppJson<CompanyTeamResult & { ok?: true }>(
      `/v1/companies/${encodeURIComponent(companyRecordId)}/team`,
      session
    );
  }
  return getSdkClient().request<CompanyTeamResult>("getCompanyTeam", companyRecordId);
});
handle("communication-threads:messages", async (threadRecordId: string) => {
  const session = await readStoredDesktopSession();
  if (session) {
    return fetchAppJson<CommunicationThreadMessagesResult & { ok?: true }>(
      `/v1/communication-threads/${encodeURIComponent(threadRecordId)}/messages`,
      session
    );
  }
  return getSdkClient().request<CommunicationThreadMessagesResult>("getCommunicationThreadMessages", threadRecordId);
});
handle("records:labels", async (objectSlug: string, recordIds: string[]) => {
  const session = await readStoredDesktopSession();
  if (session) {
    const labels: RecordLabelsResult["labels"] = [];
    for (let index = 0; index < recordIds.length; index += RECORD_LABEL_BATCH_SIZE) {
      const batch = recordIds.slice(index, index + RECORD_LABEL_BATCH_SIZE);
      if (batch.length === 0) continue;
      const result = await fetchAppJson<RecordLabelsResult & { ok?: true }>("/v1/records/labels", session, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ object_slug: objectSlug, record_ids: batch })
      });
      labels.push(...result.labels);
    }
    return { labels };
  }
  return getSdkClient().request<RecordLabelsResult>("getRecordLabels", objectSlug, recordIds);
});
handle("people:company", async (personRecordId: string) => {
  const session = await readStoredDesktopSession();
  if (session) {
    return fetchAppJson<PersonCompanyResult & { ok?: true }>(
      `/v1/people/${encodeURIComponent(personRecordId)}/company`,
      session
    );
  }
  return getSdkClient().request<PersonCompanyResult>("getPersonCompany", personRecordId);
});
handle("signals:list", async () => {
  if (await readStoredDesktopSession()) return [];
  return getSdkClient().request("listSignals");
});
handle("signals:failures", async () => {
  if (await readStoredDesktopSession()) return [];
  return getSdkClient().request("listSignalFailures");
});
handle("signals:runs", async () => {
  if (await readStoredDesktopSession()) return [];
  return getSdkClient().request("listSignalRuns");
});
handle("signals:sync", async () => {
  if (await readStoredDesktopSession()) {
    return { definitions: 0, attributes_created: 0, attributes_updated: 0 };
  }
  const result = await getSdkClient().request("syncSignals");
  sendToMainWindow("workspace:changed");
  return result;
});
handle("signals:run", async (request: SignalRunRequest = {}) => {
  if (await readStoredDesktopSession()) {
    throw new Error("Cloud signals are not available in the desktop app yet.");
  }
  return getSdkClient().request("runSignals", request);
});
handle("auth:get-config", async () => fetchAuthRuntimeConfig());
handle("auth:start-external", async (payload: StartExternalAuthPayload) => startExternalAuth(payload));
handle("auth:complete-desktop", async (payload: CompleteDesktopAuthPayload) => completeDesktopAuth(payload));
handle("auth:get-session", async () => {
  const session = await readStoredDesktopSession();
  return session ? authSessionSummary(session) : null;
});
handle("auth:sign-out", async () => {
  await clearStoredDesktopSession();
  await markDesktopSignedOut();
  await clearElectronAuthStorage();
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
  await ensureAgentCliPreflight();
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

handle("agent-cli-preflight:get-status", async () => agentCliPreflightStatus);

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

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleDesktopAuthCallbackUrl(url);
});

app
  .whenReady()
  .then(async () => {
    if (isDev && process.platform === "darwin") app.dock?.setIcon(devIconPath);
    registerDesktopAuthProtocol();
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
  stopCloudSync();
  killAllPtys();
  void sdkClient?.dispose();
});
