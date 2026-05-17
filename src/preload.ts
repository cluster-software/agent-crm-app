import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AppBridge,
  CreateRecordPayload,
  ImportCsvPayload,
  TranscriptPayload
} from "./shared/types.js";

function unwrapError(error: unknown): never {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      throw new Error(parsed.message ?? error.message);
    } catch {
      throw error;
    }
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
  openWorkspaceDialog: () => invoke("workspace:open-dialog"),
  createWorkspaceDialog: () => invoke("workspace:create-dialog"),
  openWorkspacePath: (filePath: string) => invoke("workspace:open-path", filePath),
  closeWorkspace: () => invoke("workspace:close"),
  getWorkspace: () => invoke("workspace:get"),
  listRecords: (objectSlug: string) => invoke("records:list", objectSlug),
  importCsv: (payload: ImportCsvPayload) => invoke("import:csv", payload),
  importTranscript: (payload: TranscriptPayload) => invoke("import:transcript", payload),
  createRecord: (payload: CreateRecordPayload) => invoke("records:create", payload),
  runQuery: (sql: string, params?: unknown[]) => invoke("query:run", sql, params)
};

const terminal = {
  subscribe: (id: string, cols: number, rows: number, cwd?: string) =>
    invoke<string>("pty:subscribe", id, cols, rows, cwd),
  send: (id: string, data: string) => ipcRenderer.send("pty:input", id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", id, cols, rows),
  kill: (id: string) => ipcRenderer.send("pty:kill", id),
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
