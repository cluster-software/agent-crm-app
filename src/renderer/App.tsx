import {
  Building2,
  ChevronRight,
  Database,
  FileText,
  FilePlus2,
  FolderOpen,
  Globe,
  Handshake,
  Loader2,
  Mail,
  Newspaper,
  Phone,
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
import { api } from "./api";
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
  GitHubIcon,
  LinkedInIcon,
  MonoLabel,
  XIcon
} from "./primitives";

const sdkObjectOrder = ["companies", "people", "deals", "posts", "transcripts"];
const SIDEBAR_VISIBLE_OBJECTS = new Set(["companies", "people", "deals"]);

type PersonTab = "overview" | "transcripts" | "posts";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function isTerminalTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".terminal") !== null;
}

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
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailRecord, setDetailRecord] = useState<RecordPreview | null>(null);
  const [personTab, setPersonTab] = useState<PersonTab>("overview");

  useEffect(() => {
    setDetailRecord(null);
  }, [selectedObjectSlug]);

  useEffect(() => {
    setPersonTab("overview");
  }, [detailRecord?.record_id]);
  const [terminalWidth, setTerminalWidth] = useState(() => {
    if (typeof window === "undefined") return 720;
    const stored = window.localStorage.getItem("terminalWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 280 ? parsed : 720;
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

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      if (isTerminalTarget(event.target)) return;

      if (detailRecord && personTab !== "overview") {
        event.preventDefault();
        setPersonTab("overview");
        return;
      }
      if (detailRecord) {
        event.preventDefault();
        setDetailRecord(null);
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [detailRecord, personTab]);

  const [dataVersion, setDataVersion] = useState(0);

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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshWorkspace().catch((err) => setError(statusFromError(err)));
        setDataVersion((v) => v + 1);
      }, 150);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") trigger();
    };
    const unsubscribeWorkspace = api.onWorkspaceChanged(trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeWorkspace();
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  const workspaceLabel = workspace?.filename ?? "No workspace";

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      <aside className="sidebar" hidden={!sidebarOpen}>
        <div className="traffic-space" />
        <div className="workspace-switcher">
          <span className="workspace-label">Agent CRM</span>
        </div>

        <div className="sidebar-section">
          {schemaObjects.length > 0 ? (
            schemaObjects
              .filter((object) => SIDEBAR_VISIBLE_OBJECTS.has(object.object_slug))
              .map((object) => {
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
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="breadcrumb">
            {detailRecord && selectedObject ? (
              <>
                <button
                  type="button"
                  className="breadcrumb__link"
                  onClick={() => setDetailRecord(null)}
                >
                  {selectedObject.plural_name}
                </button>
                <span className="breadcrumb__sep">
                  <ChevronRight size={11} className="lucide" />
                </span>
                <span className="breadcrumb__current">{detailRecord.label}</span>
              </>
            ) : (
              <>
                <span className="breadcrumb__current">
                  {selectedObject?.plural_name ?? workspaceLabel}
                </span>
                {workspace && selectedObject && (
                  <Badge style={{ marginLeft: 4 }}>
                    {formatNumber(workspace.counts[selectedObject.object_slug] ?? 0)}
                  </Badge>
                )}
              </>
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
            ) : detailRecord && selectedObject?.object_slug === "people" ? (
              <PersonDetail record={detailRecord} tab={personTab} onTabChange={setPersonTab} />
            ) : selectedObject ? (
              <RecordsView
                object={selectedObject}
                onChanged={refreshWorkspace}
                dataVersion={dataVersion}
                onRowClick={
                  selectedObject.object_slug === "people" ? setDetailRecord : undefined
                }
                setError={setError}
              />
            ) : null}
          </div>
          <TerminalPane
            visible={terminalOpen}
            cwd={workspace?.path}
            width={terminalWidth}
            onWidthChange={setTerminalWidth}
            onClose={() => setTerminalOpen(false)}
            setError={setError}
          />
        </div>

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
  dataVersion,
  onRowClick,
  setError
}: {
  object: SchemaObject;
  onChanged: () => Promise<WorkspaceSummary | null>;
  dataVersion: number;
  onRowClick?: (record: RecordPreview) => void;
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
  }, [loadRecords, dataVersion]);

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
          onRowClick={onRowClick}
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

const COLUMNS_BY_OBJECT: Record<string, Array<[string, string]>> = {
  companies: [
    ["linkedin_url", "LinkedIn"],
    ["twitter_url", "X"],
    ["domains", "Domain"]
  ],
  people: [
    ["linkedin_url", "LinkedIn"],
    ["twitter_url", "X"],
    ["email_addresses", "Email"]
  ]
};

function pickValueColumns(object: SchemaObject, records: RecordPreview[]) {
  const override = COLUMNS_BY_OBJECT[object.object_slug];
  if (override) return override;
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
          const showSubtitle =
            !COLUMNS_BY_OBJECT[object.object_slug] &&
            record.subtitle &&
            record.subtitle !== object.singular_name;
          return (
            <span className="cell-identity">
              <IdentityMark object={object} name={record.label} />
              <span className="cell-identity__name">{record.label}</span>
              {showSubtitle && (
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
  valueColumns,
  onRowClick
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: Array<[string, string]>;
  onRowClick?: (record: RecordPreview) => void;
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
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
      fontFamily: "Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.0,
      letterSpacing: 0,
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
          if (!backlog) {
            bridge.send(sessionId, "claude\n");
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

type RelatedRecord = {
  id: string;
  attrs: Record<string, unknown>;
};

async function fetchAssociated(
  personRecordId: string,
  childObject: "transcripts" | "posts",
  inverseAttribute: string
): Promise<RelatedRecord[]> {
  const result = await api.runQuery(
    `SELECT v.ref_record_id AS rec_id, tv.attribute_slug AS attr, tv.value_json AS val
       FROM acrm_value v
       LEFT JOIN acrm_value tv
         ON tv.object_slug = $2
        AND tv.record_id = v.ref_record_id
        AND tv.active_until IS NULL
      WHERE v.object_slug = 'people'
        AND v.record_id = $1
        AND v.attribute_slug = $3
        AND v.ref_object = $2
        AND v.active_until IS NULL`,
    [personRecordId, childObject, inverseAttribute]
  );

  const map = new Map<string, RelatedRecord>();
  for (const row of result.rows) {
    const id = row.rec_id == null ? "" : String(row.rec_id);
    if (!id) continue;
    let entry = map.get(id);
    if (!entry) {
      entry = { id, attrs: {} };
      map.set(id, entry);
    }
    if (row.attr != null) {
      entry.attrs[String(row.attr)] = parseValueJson(row.val);
    }
  }
  return [...map.values()];
}

function parseValueJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getScalar(attrs: Record<string, unknown>, key: string): string {
  const value = attrs[key];
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidate =
      obj.value ?? obj.title ?? obj.timestamp ?? obj.date ?? obj.text ?? obj.url;
    if (candidate != null) return String(candidate);
  }
  return "";
}

function formatDateDisplay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatDuration(value: unknown): string {
  const raw = typeof value === "object" && value !== null
    ? (value as { value?: unknown }).value
    : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  const mins = Math.round(n / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function transcriptPrimary(item: RelatedRecord): string {
  return (
    getScalar(item.attrs, "title") ||
    getScalar(item.attrs, "source_id") ||
    `Transcript ${item.id.slice(0, 8)}`
  );
}

function transcriptSecondary(item: RelatedRecord): string {
  const parts: string[] = [];
  const source = getScalar(item.attrs, "source");
  if (source) parts.push(source);
  const started = getScalar(item.attrs, "started_at");
  if (started) parts.push(formatDateDisplay(started));
  const dur = formatDuration(item.attrs.duration_seconds);
  if (dur) parts.push(dur);
  return parts.join(" · ");
}

function postPrimary(item: RelatedRecord): string {
  const content = getScalar(item.attrs, "content");
  if (content) {
    const trimmed = content.trim();
    return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
  }
  return getScalar(item.attrs, "url") || `Post ${item.id.slice(0, 8)}`;
}

function postSecondary(item: RelatedRecord): string {
  const parts: string[] = [];
  const platform = getScalar(item.attrs, "platform");
  if (platform) parts.push(platform);
  const postedAt = getScalar(item.attrs, "posted_at");
  if (postedAt) parts.push(formatDateDisplay(postedAt));
  return parts.join(" · ");
}

function PersonDetail({
  record,
  tab,
  onTabChange
}: {
  record: RecordPreview;
  tab: PersonTab;
  onTabChange: (tab: PersonTab) => void;
}) {
  const meta = record.subtitle && record.subtitle !== "Person" ? record.subtitle : null;
  const contactRows = buildContactRows(record);

  const [transcripts, setTranscripts] = useState<RelatedRecord[]>([]);
  const [posts, setPosts] = useState<RelatedRecord[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [relatedError, setRelatedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingRelated(true);
    setRelatedError(null);
    Promise.all([
      fetchAssociated(record.record_id, "transcripts", "associated_transcripts"),
      fetchAssociated(record.record_id, "posts", "associated_posts")
    ])
      .then(([t, p]) => {
        if (cancelled) return;
        setTranscripts(
          [...t].sort((a, b) =>
            getScalar(b.attrs, "started_at").localeCompare(getScalar(a.attrs, "started_at"))
          )
        );
        setPosts(
          [...p].sort((a, b) =>
            getScalar(b.attrs, "posted_at").localeCompare(getScalar(a.attrs, "posted_at"))
          )
        );
      })
      .catch((err) => {
        if (!cancelled) setRelatedError(statusFromError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingRelated(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.record_id]);

  return (
    <div className="detail">
      <header className="detail__header">
        <h1 className="detail__title display">{record.label}</h1>
        {meta && <div className="detail__meta">{meta}</div>}
      </header>

      <nav className="detail__tabs tabs">
        <button
          type="button"
          className="tab"
          aria-current={tab === "overview"}
          onClick={() => onTabChange("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className="tab"
          aria-current={tab === "transcripts"}
          onClick={() => onTabChange("transcripts")}
        >
          Transcripts <span className="tab__count">{transcripts.length}</span>
        </button>
        <button
          type="button"
          className="tab"
          aria-current={tab === "posts"}
          onClick={() => onTabChange("posts")}
        >
          Posts <span className="tab__count">{posts.length}</span>
        </button>
      </nav>

      {tab === "overview" ? (
        <div className="detail__body">
          <section className="detail__activity">
            <MonoLabel>Recent activity</MonoLabel>
            <div className="empty-inline">
              <span>no activity yet · agent runs and transcripts will appear here</span>
            </div>
          </section>

          <aside className="detail__aside">
            <MonoLabel>Contact</MonoLabel>
            {contactRows.length === 0 ? (
              <div className="empty-inline">
                <span>no contact info on file</span>
              </div>
            ) : (
              <div className="detail__contact">
                {contactRows.map((row, index) => (
                  <div key={index} className="detail__contact-row">
                    <row.Icon size={13} className="lucide" />
                    <span className="mono">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <section className="detail__tab-panel">
          {relatedError ? (
            <div className="empty-inline"><span>{relatedError}</span></div>
          ) : loadingRelated ? (
            <div className="empty-inline"><span>loading…</span></div>
          ) : tab === "transcripts" ? (
            <RelatedList
              items={transcripts}
              empty="no transcripts linked to this person yet"
              renderPrimary={transcriptPrimary}
              renderSecondary={transcriptSecondary}
            />
          ) : (
            <RelatedList
              items={posts}
              empty="no posts linked to this person yet"
              renderPrimary={postPrimary}
              renderSecondary={postSecondary}
            />
          )}
        </section>
      )}
    </div>
  );
}

function RelatedList({
  items,
  empty,
  renderPrimary,
  renderSecondary
}: {
  items: RelatedRecord[];
  empty: string;
  renderPrimary: (item: RelatedRecord) => string;
  renderSecondary: (item: RelatedRecord) => string;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-inline">
        <span>{empty}</span>
      </div>
    );
  }
  return (
    <ul className="related-list">
      {items.map((item) => {
        const secondary = renderSecondary(item);
        return (
          <li key={item.id} className="related-list__item">
            <div className="related-list__primary">{renderPrimary(item)}</div>
            {secondary && <div className="related-list__secondary">{secondary}</div>}
          </li>
        );
      })}
    </ul>
  );
}

type ContactRow = {
  Icon: ComponentType<{ size?: number; className?: string }>;
  value: string;
};

function buildContactRows(record: RecordPreview): ContactRow[] {
  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  const push = (Icon: ContactRow["Icon"], value: string) => {
    const key = `${Icon.name}:${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ Icon, value });
  };

  for (const value of record.values) {
    const display = value.display?.trim();
    if (!display) continue;
    switch (value.attribute_slug) {
      case "email_addresses":
      case "email":
        for (const item of display.split(",").map((s) => s.trim()).filter(Boolean)) {
          push(Mail, item);
        }
        break;
      case "phone":
      case "phone_number":
      case "phone_numbers":
        for (const item of display.split(",").map((s) => s.trim()).filter(Boolean)) {
          push(Phone, item);
        }
        break;
      case "linkedin_url":
        push(LinkedInIcon, stripUrl(display));
        break;
      case "twitter_url":
      case "x_url":
        push(XIcon, stripUrl(display));
        break;
      case "github_url":
      case "github":
        push(GitHubIcon, stripUrl(display));
        break;
      case "website":
      case "url":
      case "domain":
      case "domains":
        push(Globe, stripUrl(display));
        break;
      default:
        if (/github\.com/i.test(display)) {
          push(GitHubIcon, stripUrl(display));
        } else if (/linkedin\.com/i.test(display)) {
          push(LinkedInIcon, stripUrl(display));
        } else if (/(?:^|\W)(?:x\.com|twitter\.com)/i.test(display)) {
          push(XIcon, stripUrl(display));
        }
        break;
    }
  }
  return rows;
}

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
