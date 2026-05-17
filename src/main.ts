import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CreateRecordPayload,
  ImportCsvPayload,
  QueryResult,
  RecordPreview,
  TranscriptImportResult,
  TranscriptPayload,
  WorkspaceSummary
} from "./shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let sdkClient: SdkServiceClient | null = null;

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

    const nodeBinary = process.env.SDK_NODE_BINARY ?? "node";
    const scriptPath = path.join(__dirname, "sdk-service.js");
    const child = spawn(nodeBinary, [scriptPath], {
      cwd: app.getAppPath(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
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

handle("workspace:open-dialog", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Agent CRM workspace",
    properties: ["openFile"],
    filters: [{ name: "Agent CRM workspace", extensions: ["acrm"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return getSdkClient().request<WorkspaceSummary>("openWorkspace", result.filePaths[0]);
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
  return getSdkClient().request<WorkspaceSummary>("createWorkspace", filePath);
});

handle("workspace:open-path", (filePath: string) => {
  return getSdkClient().request<WorkspaceSummary>("openWorkspace", filePath);
});
handle("workspace:close", async () => {
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
  void sdkClient?.dispose();
});
