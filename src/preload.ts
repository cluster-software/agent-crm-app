import { contextBridge, ipcRenderer } from "electron";
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

contextBridge.exposeInMainWorld("crm", bridge);
