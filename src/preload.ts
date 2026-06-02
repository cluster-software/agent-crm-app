import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from "electron";
import type {
  AgentCliPreflightStatus,
  AppBridge,
  CreateRecordPayload,
  ImportCsvPayload,
  SignalRunRequest,
  TerminalDroppedFilePayload,
  TranscriptPayload,
  UpdateDealPayload,
  UpdateRecordPayload,
  UpdateStatus
} from "./shared/types.js";

function unwrapError(error: unknown): never {
  if (error instanceof Error) {
    let message: string | null = null;
    try {
      const parsed = JSON.parse(error.message);
      if (typeof parsed?.message === "string") {
        message = parsed.message;
      }
    } catch {
      // Fall through to the original Electron error when it is not our JSON
      // envelope.
    }
    if (message) throw new Error(message);
    throw error;
  }
  throw error;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    unwrapError(error);
  }
}

const bridge: AppBridge = {
  platform: process.platform,
  getAuthConfig: () => invoke("auth:get-config"),
  startExternalAuth: (payload) => invoke("auth:start-external", payload),
  completeDesktopAuth: (payload) => invoke("auth:complete-desktop", payload),
  getAuthSession: () => invoke("auth:get-session"),
  signOut: () => invoke("auth:sign-out"),
  closeWorkspace: () => invoke("workspace:close"),
  getWorkspace: () => invoke("workspace:get"),
  listRecords: (objectSlug: string, options) => invoke("records:list", objectSlug, options),
  importCsv: (payload: ImportCsvPayload) => invoke("import:csv", payload),
  importTranscript: (payload: TranscriptPayload) => invoke("import:transcript", payload),
  createRecord: (payload: CreateRecordPayload) => invoke("records:create", payload),
  updateRecord: (payload: UpdateRecordPayload) => invoke("records:update", payload),
  updateDeal: (payload: UpdateDealPayload) => invoke("deals:update", payload),
  runQuery: (sql: string, params?: unknown[]) => invoke("query:run", sql, params),
  listSignals: () => invoke("signals:list"),
  listSignalFailures: () => invoke("signals:failures"),
  listSignalRuns: () => invoke("signals:runs"),
  syncSignals: () => invoke("signals:sync"),
  runSignals: (request?: SignalRunRequest) => invoke("signals:run", request),
  getCloudSyncStatus: () => invoke("cloud-sync:get-status"),
  triggerCloudSync: () => invoke("cloud-sync:trigger"),
  getCloudIntegrations: () => invoke("cloud-integrations:get"),
  onWorkspaceChanged: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.off("workspace:changed", listener);
  },
  onCloudSyncStatus: (handler) => {
    const listener = (_event: IpcRendererEvent, status: Parameters<typeof handler>[0]) => handler(status);
    ipcRenderer.on("cloud-sync:status", listener);
    void invoke<Parameters<typeof handler>[0]>("cloud-sync:get-status").then(handler).catch(() => undefined);
    return () => ipcRenderer.off("cloud-sync:status", listener);
  },
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => handler(status);
    ipcRenderer.on("update:status", listener);
    void invoke<UpdateStatus>("update:get-status").then(handler).catch(() => undefined);
    return () => ipcRenderer.off("update:status", listener);
  },
  installUpdate: () => invoke("update:install")
};

const terminal = {
  subscribe: (id: string, cols: number, rows: number, cwd?: string) =>
    invoke<string>("pty:subscribe", id, cols, rows, cwd),
  send: (id: string, data: string) => ipcRenderer.send("pty:input", id, data),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  persistDroppedFile: (payload: TerminalDroppedFilePayload) =>
    invoke<string>("pty:persist-dropped-file", payload),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", id, cols, rows),
  kill: (id: string) => ipcRenderer.send("pty:kill", id),
  getAgentCliPreflightStatus: () => invoke<AgentCliPreflightStatus>("agent-cli-preflight:get-status"),
  onAgentCliPreflightStatus: (handler: (status: AgentCliPreflightStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: AgentCliPreflightStatus) => handler(status);
    ipcRenderer.on("agent-cli-preflight:status", listener);
    void invoke<AgentCliPreflightStatus>("agent-cli-preflight:get-status")
      .then(handler)
      .catch(() => undefined);
    return () => ipcRenderer.off("agent-cli-preflight:status", listener);
  },
  onData: (id: string, handler: (data: string) => void) => {
    const listener = (_event: IpcRendererEvent, sessionId: string, data: string) => {
      if (sessionId === id) handler(data);
    };
    ipcRenderer.on("pty:data", listener);
    return () => ipcRenderer.off("pty:data", listener);
  },
  onExit: (id: string, handler: (info: { exitCode: number; signal?: number }) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      sessionId: string,
      info: { exitCode: number; signal?: number }
    ) => {
      if (sessionId === id) handler(info);
    };
    ipcRenderer.on("pty:exit", listener);
    return () => ipcRenderer.off("pty:exit", listener);
  }
};

contextBridge.exposeInMainWorld("crm", bridge);
contextBridge.exposeInMainWorld("terminal", terminal);
