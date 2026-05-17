import {
  Building2,
  Database,
  FileText,
  FilePlus2,
  FolderOpen,
  Handshake,
  Loader2,
  Newspaper,
  Plus,
  Terminal,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComponentType,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import { api, isPreviewMode } from "./api";
import type {
  CreateRecordPayload,
  RecordPreview,
  RecordValue,
  SchemaObject,
  WorkspaceSummary
} from "../shared/types";
import {
  Avatar,
  Badge,
  CompanyMark,
  MonoLabel,
  StatusPill
} from "./primitives";

const sdkObjectOrder = ["companies", "people", "deals", "posts", "transcripts"];

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function statusFromError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [selectedObjectSlug, setSelectedObjectSlug] = useState("companies");
  const [loading, setLoading] = useState("Loading workspace");
  const [error, setError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalWidth, setTerminalWidth] = useState(() => {
    if (typeof window === "undefined") return 420;
    const stored = window.localStorage.getItem("terminalWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 280 ? parsed : 420;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("terminalWidth", String(Math.round(terminalWidth)));
  }, [terminalWidth]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "j") {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      } else if (key === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const summary = await api.getWorkspace();
    setWorkspace(summary);
    return summary;
  }, []);

  useEffect(() => {
    refreshWorkspace()
      .catch((err) => setError(statusFromError(err)))
      .finally(() => setLoading(""));
  }, [refreshWorkspace]);

  const schemaObjects = useMemo(
    () => orderSchemaObjects(workspace?.objects ?? []),
    [workspace]
  );
  const selectedObject =
    schemaObjects.find((object) => object.object_slug === selectedObjectSlug) ??
    schemaObjects[0];

  useEffect(() => {
    if (!workspace || schemaObjects.length === 0) return;
    if (!schemaObjects.some((object) => object.object_slug === selectedObjectSlug)) {
      setSelectedObjectSlug(defaultObjectSlug(schemaObjects));
    }
  }, [schemaObjects, selectedObjectSlug, workspace]);

  async function runWorkspaceAction(action: () => Promise<WorkspaceSummary | null>) {
    setError(null);
    try {
      const summary = await action();
      if (summary) {
        setWorkspace(summary);
        setSelectedObjectSlug(defaultObjectSlug(orderSchemaObjects(summary.objects)));
      }
    } catch (err) {
      setError(statusFromError(err));
    }
  }

  const totalRecords = workspace
    ? Object.values(workspace.counts).reduce((sum, value) => sum + value, 0)
    : 0;
  const workspaceLabel = workspace?.filename ?? "No workspace";

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      <aside className="sidebar" hidden={!sidebarOpen}>
        <div className="traffic-space" />
        <div className="workspace-switcher" title={workspace?.path ?? ""}>
          <span className="workspace-label">{workspaceLabel}</span>
        </div>

        <div className="sidebar-section">
          {schemaObjects.length > 0 ? (
            schemaObjects.map((object) => {
              const Icon = iconForObject(object.object_slug);
              const active = selectedObject?.object_slug === object.object_slug;
              const count = workspace?.counts[object.object_slug] ?? 0;
              return (
                <button
                  type="button"
                  className="nav-item"
                  aria-current={active}
                  key={object.object_slug}
                  onClick={() => setSelectedObjectSlug(object.object_slug)}
                >
                  <span className="nav-item__icon">
                    <Icon size={14} className="lucide" />
                  </span>
                  <span className="nav-item__label">{object.plural_name}</span>
                  <span className="nav-item__count">{formatNumber(count)}</span>
                </button>
              );
            })
          ) : (
            <div className="empty-inline">Open a workspace to load SDK objects.</div>
          )}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <span
            className="sidebar-footer__dot"
            data-state={workspace ? "live" : "idle"}
          />
          <div className="sidebar-footer__body">
            <div className="sidebar-footer__title">
              {workspace ? workspace.filename : "agent-crm"}
            </div>
            <div className="sidebar-footer__sub">
              {workspace
                ? `${formatNumber(totalRecords)} records · ${schemaObjects.length} objects`
                : isPreviewMode
                  ? "browser preview"
                  : "not connected"}
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="breadcrumb">
            <span className="breadcrumb__current">
              {selectedObject?.plural_name ?? workspaceLabel}
            </span>
            {workspace && selectedObject && (
              <Badge style={{ marginLeft: 4 }}>
                {formatNumber(workspace.counts[selectedObject.object_slug] ?? 0)}
              </Badge>
            )}
          </div>
          <div className="toolbar__spacer" />
          <div className="toolbar__actions">
            <button
              className="icon-btn"
              type="button"
              title="Open workspace"
              aria-label="Open workspace"
              onClick={() => runWorkspaceAction(api.openWorkspaceDialog)}
            >
              <FolderOpen size={14} className="lucide" />
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Create workspace"
              aria-label="Create workspace"
              onClick={() => runWorkspaceAction(api.createWorkspaceDialog)}
            >
              <FilePlus2 size={14} className="lucide" />
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Terminal"
              aria-label="Terminal"
              aria-pressed={terminalOpen}
              onClick={() => setTerminalOpen((open) => !open)}
            >
              <Terminal size={14} className="lucide" />
            </button>
          </div>
        </header>

        {error && (
          <div className="strip strip--error">
            <span>{error}</span>
            <button className="strip__close" type="button" onClick={() => setError(null)}>
              <X size={14} className="lucide" />
            </button>
          </div>
        )}

        {loading && (
          <div className="strip strip--loading">
            <Loader2 size={14} className="lucide spin" />
            <span>{loading}</span>
          </div>
        )}

        <div className="main__body">
          <div className="main__content">
            {!workspace ? (
              <EmptyWorkspace
                onOpen={() => runWorkspaceAction(api.openWorkspaceDialog)}
                onCreate={() => runWorkspaceAction(api.createWorkspaceDialog)}
              />
            ) : selectedObject ? (
              <RecordsView
                object={selectedObject}
                onChanged={refreshWorkspace}
                setError={setError}
              />
            ) : null}
          </div>
          <TerminalPane
            visible={terminalOpen}
            cwd={workspace ? dirnameOf(workspace.path) : undefined}
            width={terminalWidth}
            onWidthChange={setTerminalWidth}
            onClose={() => setTerminalOpen(false)}
            setError={setError}
          />
        </div>

        {workspace && (
          <footer className="status-bar">
            <StatusPill state="ok" label="workspace connected" />
            <span className="status-bar__sep" />
            <span>{formatNumber(totalRecords)} records</span>
            <span className="status-bar__sep" />
            <span>{schemaObjects.length} objects</span>
            <span className="status-bar__cli">
              cli ▸ agent-crm open {workspace.filename}
            </span>
          </footer>
        )}
      </main>
    </div>
  );
}

function orderSchemaObjects(objects: SchemaObject[]) {
  const order = new Map(sdkObjectOrder.map((slug, index) => [slug, index]));
  return [...objects].sort((a, b) => {
    const left = order.get(a.object_slug) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.object_slug) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.plural_name.localeCompare(b.plural_name);
  });
}

function defaultObjectSlug(objects: SchemaObject[]) {
  return objects[0]?.object_slug ?? "companies";
}

function iconForObject(objectSlug: string): ComponentType<{ size?: number; className?: string }> {
  switch (objectSlug) {
    case "companies":
      return Building2;
    case "people":
      return Users;
    case "deals":
      return Handshake;
    case "posts":
      return Newspaper;
    case "transcripts":
      return FileText;
    default:
      return Database;
  }
}

function EmptyWorkspace({ onOpen, onCreate }: { onOpen: () => void; onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark">
        <Database size={20} className="lucide" />
      </div>
      <h1 className="empty-state__title">Connect a workspace</h1>
      <p className="empty-state__sub">
        Open an existing <span className="mono">.acrm</span> file or create a new workspace seeded by the SDK.
      </p>
      <div className="empty-state__actions">
        <button className="btn btn--primary" type="button" onClick={onCreate}>
          <FilePlus2 size={14} className="lucide" />
          <span>Create workspace</span>
        </button>
        <button className="btn" type="button" onClick={onOpen}>
          <FolderOpen size={14} className="lucide" />
          <span>Open workspace</span>
        </button>
      </div>
    </div>
  );
}

function RecordsView({
  object,
  onChanged,
  setError
}: {
  object: SchemaObject;
  onChanged: () => Promise<WorkspaceSummary | null>;
  setError: (error: string | null) => void;
}) {
  const [records, setRecords] = useState<RecordPreview[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const loadRecords = useCallback(async () => {
    try {
      setRecords(await api.listRecords(object.object_slug));
    } catch (err) {
      setError(statusFromError(err));
    }
  }, [object.object_slug, setError]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function handleCreate(payload: CreateRecordPayload) {
    try {
      await api.createRecord(payload);
      await onChanged();
      await loadRecords();
      setShowCreate(false);
    } catch (err) {
      setError(statusFromError(err));
    }
  }

  const valueColumns = pickValueColumns(object, records);

  return (
    <>
      <div className="filter-bar">
        <div style={{ flex: 1 }} />
        <button
          className="btn btn--sm btn--primary"
          type="button"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={13} className="lucide" />
          <span>New</span>
        </button>
      </div>

      <div className="table">
        <RecordsTable
          object={object}
          records={records}
          valueColumns={valueColumns}
        />
      </div>

      {showCreate && (
        <CreateRecordModal
          object={object}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}
    </>
  );
}

function pickValueColumns(object: SchemaObject, records: RecordPreview[]) {
  const seen = new Map<string, string>();
  for (const record of records) {
    for (const value of record.values) {
      if (!seen.has(value.attribute_slug)) {
        seen.set(value.attribute_slug, value.title);
      }
    }
  }
  for (const attribute of object.attributes) {
    if (!seen.has(attribute.attribute_slug)) {
      seen.set(attribute.attribute_slug, attribute.title);
    }
  }
  const skip = new Set(["name", "primary_email", "full_name", "title"]);
  return Array.from(seen.entries())
    .filter(([slug]) => !skip.has(slug))
    .slice(0, 3);
}

const columnHelper = createColumnHelper<RecordPreview>();

function useRecordColumns(object: SchemaObject, valueColumns: Array<[string, string]>) {
  return useMemo(() => {
    const cols = [
      columnHelper.display({
        id: "select",
        header: () => null,
        cell: () => <span className="cell-check" />,
        meta: { width: "28px" }
      }),
      columnHelper.accessor((record) => record.label, {
        id: "identity",
        header: object.singular_name,
        cell: (info) => {
          const record = info.row.original;
          return (
            <span className="cell-identity">
              <IdentityMark object={object} name={record.label} />
              <span className="cell-identity__name">{record.label}</span>
              {record.subtitle && (
                <span className="cell-identity__domain">{record.subtitle}</span>
              )}
            </span>
          );
        },
        meta: { width: "minmax(220px, 1.6fr)" }
      }),
      ...valueColumns.map(([slug, title]) =>
        columnHelper.accessor(
          (record) => record.values.find((value) => value.attribute_slug === slug),
          {
            id: slug,
            header: title,
            cell: (info) => <ValueCell value={info.getValue()} />,
            meta: { width: "minmax(140px, 1fr)" }
          }
        )
      )
    ];
    return cols;
  }, [object, valueColumns]);
}

function RecordsTable({
  object,
  records,
  valueColumns
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: Array<[string, string]>;
}) {
  const columns = useRecordColumns(object, valueColumns);
  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (record) => `${record.object_slug}:${record.record_id}`
  });

  const columnTemplate = table
    .getVisibleLeafColumns()
    .map((column) => (column.columnDef.meta as { width?: string } | undefined)?.width ?? "1fr")
    .join(" ");
  const gridStyle = { ["--columns" as string]: columnTemplate };

  return (
    <>
      {table.getHeaderGroups().map((headerGroup) => (
        <div key={headerGroup.id} className="table__head" style={gridStyle}>
          {headerGroup.headers.map((header) => (
            <span key={header.id}>
              {header.isPlaceholder
                ? null
                : (flexRender(header.column.columnDef.header, header.getContext()) as ReactNode)}
            </span>
          ))}
        </div>
      ))}
      <div className="table__body">
        {records.length === 0 ? (
          <div className="empty-inline">
            <span>no records yet · run an import or create one</span>
          </div>
        ) : (
          table.getRowModel().rows.map((row, index) => (
            <div
              key={row.id}
              className="table__row"
              data-touched={index === 0 ? "true" : undefined}
              style={gridStyle}
            >
              {row.getVisibleCells().map((cell) => (
                <span key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext()) as ReactNode}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function IdentityMark({ object, name }: { object: SchemaObject; name: string }) {
  if (object.object_slug === "people") return <Avatar name={name} size={20} />;
  if (object.object_slug === "companies") return <CompanyMark name={name} size={20} />;
  return <CompanyMark name={`${object.singular_name} ${name}`} size={20} />;
}

function ValueCell({ value }: { value?: RecordValue }) {
  if (!value || !value.display) return <span className="table__cell--muted">—</span>;
  if (looksLikeStage(value)) return <Badge kind={stageKind(value.display)} dot>{value.display}</Badge>;
  if (looksMono(value)) return <span className="table__cell--mono">{value.display}</span>;
  return <span className="table__cell--muted">{value.display}</span>;
}

function looksLikeStage(value: RecordValue) {
  return value.type === "status" || value.attribute_slug === "stage";
}

function stageKind(display: string): "success" | "warning" | "danger" | "accent" | "neutral" {
  const v = display.toLowerCase();
  if (["live", "expansion", "won", "active"].some((s) => v.includes(s))) return "success";
  if (["eval", "queued", "in progress", "trial"].some((s) => v.includes(s))) return "warning";
  if (["churn", "lost", "error"].some((s) => v.includes(s))) return "danger";
  return "neutral";
}

function looksMono(value: RecordValue) {
  return (
    value.type === "url" ||
    value.type === "domain" ||
    value.attribute_slug.endsWith("_id") ||
    value.attribute_slug === "linkedin_url" ||
    value.attribute_slug === "domains"
  );
}

function CreateRecordModal({
  object,
  onClose,
  onSubmit
}: {
  object: SchemaObject;
  onClose: () => void;
  onSubmit: (payload: CreateRecordPayload) => Promise<void>;
}) {
  const starter = object.attributes
    .slice(0, 4)
    .map((attribute) => `${attribute.attribute_slug}=`)
    .join("\n");
  const [fields, setFields] = useState(starter);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit({
      object_slug: object.object_slug,
      fields: fields
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      source: "electron"
    });
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div className="page-heading__meta">
            <h2>New {object.singular_name.toLowerCase()}</h2>
            <p>Use SDK field syntax: <span className="mono">attribute=value</span>, one per line.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>
            <X size={14} className="lucide" />
          </button>
        </div>
        <div className="modal__body">
          <textarea
            className="textarea"
            rows={6}
            value={fields}
            onChange={(event) => setFields(event.target.value)}
            spellCheck={false}
          />
          <MonoLabel>Attributes</MonoLabel>
          <div className="attribute-hints">
            {object.attributes.map((attribute) => (
              <Badge key={attribute.attribute_slug}>{attribute.attribute_slug}</Badge>
            ))}
          </div>
        </div>
        <div className="modal__actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? <Loader2 size={13} className="lucide spin" /> : <Plus size={13} className="lucide" />}
            <span>Create</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function readCssColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;background:var(${varName})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed && computed !== "rgba(0, 0, 0, 0)" ? computed : fallback;
}

function makeXtermTheme() {
  return {
    background: readCssColor("--bg", "#181410"),
    foreground: "#f1ece2",
    cursor: "#f1ece2",
    cursorAccent: readCssColor("--bg", "#181410"),
    selectionBackground: "rgba(120, 145, 220, 0.30)",
    black: "#1c1b18",
    red: "#e07a5f",
    green: "#8aae6a",
    yellow: "#d8b25c",
    blue: "#7891dc",
    magenta: "#b78bd6",
    cyan: "#70c1c1",
    white: "#d6cfc1",
    brightBlack: "#5c574d",
    brightRed: "#ec9075",
    brightGreen: "#a0c47f",
    brightYellow: "#e4c478",
    brightBlue: "#8fa6e6",
    brightMagenta: "#c79de0",
    brightCyan: "#86d2d2",
    brightWhite: "#f1ece2"
  };
}

function dirnameOf(filePath: string): string | undefined {
  if (!filePath) return undefined;
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (idx <= 0) return undefined;
  return filePath.slice(0, idx);
}

function sessionIdFor(cwd: string | undefined): string {
  return `pty:${cwd ?? "default"}`;
}

const TERMINAL_MIN_WIDTH = 280;
const TERMINAL_MAX_WIDTH_FRACTION = 0.7;

function TerminalPane({
  visible,
  cwd,
  width,
  onWidthChange,
  onClose,
  setError
}: {
  visible: boolean;
  cwd?: string;
  width: number;
  onWidthChange: (next: number) => void;
  onClose: () => void;
  setError: (error: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>(sessionIdFor(cwd));

  useEffect(() => {
    const bridge = window.terminal;
    const container = containerRef.current;
    if (!bridge || !container) {
      setError("Terminal bridge unavailable — restart the Electron app.");
      return;
    }
    const sessionId = sessionIdFor(cwd);
    sessionIdRef.current = sessionId;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      convertEol: true,
      theme: makeXtermTheme()
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container);

    // macOS keybinding translations. Returning false from this handler tells xterm to skip
    // its default processing — we then send the equivalent control sequence ourselves.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const meta = event.metaKey;
      const alt = event.altKey;
      const ctrl = event.ctrlKey;
      const shift = event.shiftKey;

      // ⌘+(Backspace|Delete) → ^U: kill from cursor to start of line
      if (meta && !ctrl && !alt && (event.key === "Backspace" || event.key === "Delete")) {
        bridge.send(sessionId, "\x15");
        event.preventDefault();
        return false;
      }
      // ⌘+← / ⌘+→: jump to start/end of line (^A / ^E)
      if (meta && !ctrl && !alt && !shift && event.key === "ArrowLeft") {
        bridge.send(sessionId, "\x01");
        event.preventDefault();
        return false;
      }
      if (meta && !ctrl && !alt && !shift && event.key === "ArrowRight") {
        bridge.send(sessionId, "\x05");
        event.preventDefault();
        return false;
      }
      // ⌘K: clear screen (^L)
      if (meta && !ctrl && !alt && !shift && event.key.toLowerCase() === "k") {
        bridge.send(sessionId, "\x0c");
        event.preventDefault();
        return false;
      }
      // ⌥+Backspace: delete previous word (^W)
      if (alt && !meta && !ctrl && event.key === "Backspace") {
        bridge.send(sessionId, "\x17");
        event.preventDefault();
        return false;
      }
      // ⌥+← / ⌥+→: jump word back/forward (ESC b / ESC f)
      if (alt && !meta && !ctrl && !shift && event.key === "ArrowLeft") {
        bridge.send(sessionId, "\x1bb");
        event.preventDefault();
        return false;
      }
      if (alt && !meta && !ctrl && !shift && event.key === "ArrowRight") {
        bridge.send(sessionId, "\x1bf");
        event.preventDefault();
        return false;
      }

      return true;
    });

    const focusXterm = () => {
      try {
        term.focus();
      } catch {
        // ignore
      }
      const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
      textarea?.focus();
    };

    const safeFit = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return false;
      try {
        fit.fit();
        return true;
      } catch {
        return false;
      }
    };

    let killed = false;

    const offData = bridge.onData(sessionId, (data) => term.write(data));
    const offExit = bridge.onExit(sessionId, ({ exitCode, signal }) => {
      term.writeln("");
      term.writeln(
        `\u001b[2m[process exited · code ${exitCode}${signal ? ` · signal ${signal}` : ""}]\u001b[0m`
      );
    });
    const writeDisposable = term.onData((data) => bridge.send(sessionId, data));

    const initTimer = window.setTimeout(() => {
      safeFit();
      void bridge
        .subscribe(sessionId, Math.max(2, term.cols), Math.max(1, term.rows), cwd)
        .then((backlog) => {
          if (killed) return;
          if (backlog) term.write(backlog);
          if (safeFit()) {
            bridge.resize(sessionId, term.cols, term.rows);
          }
          focusXterm();
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          term.writeln(`\u001b[31m[failed to start shell: ${message}]\u001b[0m`);
        });
    }, 0);

    const observer = new ResizeObserver(() => {
      if (killed) return;
      if (safeFit()) {
        try {
          bridge.resize(sessionId, term.cols, term.rows);
        } catch {
          // ignore — likely mid-teardown
        }
      }
    });
    observer.observe(container);

    return () => {
      killed = true;
      window.clearTimeout(initTimer);
      observer.disconnect();
      offData();
      offExit();
      writeDisposable.dispose();
      // Tear down the PTY only when cwd changes (effect re-runs) or the app unmounts.
      // ⌘J toggles visibility via CSS — this effect does not re-run for that.
      bridge.kill(sessionId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, setError]);

  // When the pane becomes visible after being hidden, the container size jumps from 0
  // to its real dimensions. Re-fit + push the new size to the PTY, and reclaim focus.
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const container = containerRef.current;
    if (!term || !fit || !container) return;
    const raf = requestAnimationFrame(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
        window.terminal?.resize(sessionIdRef.current, term.cols, term.rows);
      } catch {
        // ignore
      }
      try {
        term.focus();
      } catch {
        // ignore
      }
      container
        .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
        ?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // ignore — some pointer types don't support capture
    }
    const onMove = (e: PointerEvent) => {
      const delta = startX - e.clientX;
      const max = Math.max(TERMINAL_MIN_WIDTH, window.innerWidth * TERMINAL_MAX_WIDTH_FRACTION);
      const next = Math.max(TERMINAL_MIN_WIDTH, Math.min(max, startWidth + delta));
      onWidthChange(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-terminal");
    };
    document.body.classList.add("resizing-terminal");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <aside className="terminal" hidden={!visible} style={{ width }}>
      <div
        className="terminal__resizer"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
      />
      <div className="terminal__head">
        <Terminal size={13} className="lucide" />
        <span className="mono-label">shell</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" type="button" onClick={onClose} title="Close terminal">
          <X size={13} className="lucide" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="terminal__xterm"
        onMouseDown={() => {
          termRef.current?.focus();
          containerRef.current
            ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
            ?.focus();
        }}
      />
    </aside>
  );
}
