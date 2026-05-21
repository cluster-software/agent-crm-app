import {
  Building2,
  ChevronRight,
  Database,
  Download,
  FileText,
  FilePlus2,
  FolderOpen,
  Globe,
  Handshake,
  Info,
  Loader2,
  Mail,
  Newspaper,
  Phone,
  Settings,
  Terminal,
  Users,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComponentType,
  Dispatch,
  FormEvent as ReactFormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction
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
  RecordPreview,
  RecordValue,
  SchemaObject,
  SignalDefinitionSummary,
  SignalRunFailureSummary,
  SignalRunJob,
  UpdateStatus,
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
type SignalPopoverTab = "sources" | "reasoning";
type MainView = "records" | "settings";

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
  const [mainView, setMainView] = useState<MainView>("records");
  const [loading, setLoading] = useState("Loading workspace");
  const [error, setError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailRecord, setDetailRecord] = useState<RecordPreview | null>(null);
  const [personTab, setPersonTab] = useState<PersonTab>("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    return api.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    setDetailRecord(null);
  }, [mainView, selectedObjectSlug]);

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
        setMainView("records");
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
              const active = mainView === "records" && selectedObject?.object_slug === object.object_slug;
              const count = workspace?.counts[object.object_slug] ?? 0;
              return (
                <button
                  type="button"
                  className="nav-item"
                  aria-current={active}
                  key={object.object_slug}
                  onClick={() => {
                    setSelectedObjectSlug(object.object_slug);
                    setMainView("records");
                  }}
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

        <button
          type="button"
          className="nav-item nav-item--settings"
          aria-current={mainView === "settings"}
          onClick={() => setMainView("settings")}
        >
          <span className="nav-item__icon">
            <Settings size={14} className="lucide" />
          </span>
          <span className="nav-item__label">Settings</span>
        </button>

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
        <UpdateBanner status={updateStatus} />
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="breadcrumb">
            {mainView === "settings" ? (
              <span className="breadcrumb__current">Settings</span>
            ) : detailRecord && selectedObject ? (
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
              onClick={() => setCreateOpen(true)}
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
                onCreate={() => setCreateOpen(true)}
              />
            ) : mainView === "settings" ? (
              <SettingsView dataVersion={dataVersion} setError={setError} />
            ) : detailRecord && selectedObject?.object_slug === "people" ? (
              <PersonDetail record={detailRecord} tab={personTab} onTabChange={setPersonTab} />
            ) : detailRecord && selectedObject ? (
              <RecordDetail object={selectedObject} record={detailRecord} />
            ) : selectedObject ? (
              <RecordsView
                object={selectedObject}
                dataVersion={dataVersion}
                onRowClick={setDetailRecord}
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
      {createOpen && (
        <CreateWorkspaceModal
          onClose={() => setCreateOpen(false)}
          onCreate={async (name) => {
            setError(null);
            const summary = await api.createWorkspace(name);
            if (summary) {
              setWorkspace(summary);
              setSelectedObjectSlug(defaultObjectSlug(orderSchemaObjects(summary.objects)));
              setMainView("records");
            }
          }}
        />
      )}
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

function CreateWorkspaceModal({
  onClose,
  onCreate
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit(event: ReactFormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (err) {
      setLocalError(statusFromError(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal modal--narrow" onSubmit={handleSubmit}>
        <div className="modal__head">
          <div>
            <h2>New workspace</h2>
            <p>Pick a name. The workspace is created under <span className="mono">~/agent-crm/</span>.</p>
          </div>
        </div>
        <div className="modal__body">
          <label className="input">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. pipeline"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
            />
          </label>
          {localError && <div className="strip strip--error">{localError}</div>}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 size={14} className="lucide spin" />
                <span>Creating</span>
              </>
            ) : (
              <span>Create</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function UpdateBanner({ status }: { status: UpdateStatus }) {
  if (status.state === "idle" || status.state === "checking" || status.state === "error") {
    return null;
  }
  const isReady = status.state === "ready";
  const label =
    status.state === "available"
      ? `Update v${status.version} available`
      : status.state === "downloading"
        ? `Downloading v${status.version} · ${status.percent}%`
        : `Restart to install v${status.version}`;
  return (
    <button
      type="button"
      className="update-banner"
      data-state={status.state}
      disabled={!isReady}
      onClick={() => {
        if (isReady) void api.installUpdate();
      }}
    >
      <Download size={13} className="lucide" />
      <span>{label}</span>
    </button>
  );
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

function SettingsView({
  dataVersion,
  setError
}: {
  dataVersion: number;
  setError: (error: string | null) => void;
}) {
  const [signals, setSignals] = useState<SignalDefinitionSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSignals(null);
    api.listSignals()
      .then((nextSignals) => {
        if (!cancelled) setSignals(nextSignals);
      })
      .catch((err) => {
        if (!cancelled) {
          setSignals([]);
          setError(statusFromError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, setError]);

  return (
    <div className="detail settings-view">
      <header className="detail__header">
        <h1 className="detail__title display">Settings</h1>
      </header>

      <nav className="detail__tabs tabs">
        <button type="button" className="tab" aria-current="true">
          Signals
          {signals && <span className="tab__count">{signals.length}</span>}
        </button>
      </nav>

      <section className="settings-panel">
        <p className="settings-panel__description">
          Signals are configured in the <code>/signals</code> directory of your workspace. They automatically fill in data about a company or person using a background web search with Claude. Use the <code>/create-signals</code> signals skill to create one or learn more.
        </p>
        {signals === null ? (
          <div className="empty-inline">
            <Loader2 size={14} className="lucide spin" />
            <span>loading signals</span>
          </div>
        ) : signals.length === 0 ? (
          <div className="empty-inline">
            <span>no signal definitions in signals/</span>
          </div>
        ) : (
          <div className="settings-signals">
            {signals.map((signal) => (
              <article className="settings-signal" key={signal.slug}>
                <header className="settings-signal__header">
                  <div className="settings-signal__title">
                    <MonoLabel>{signal.object_slug}</MonoLabel>
                    <h2>{signal.title}</h2>
                  </div>
                  <Badge>{signal.outputs.length} fields</Badge>
                </header>
                <div className="settings-signal__outputs">
                  {signal.outputs.map((output) => (
                    <div className="settings-signal__output" key={output.key}>
                      <div className="settings-signal__output-main">
                        <span>{output.title}</span>
                        <span className="settings-signal__attribute mono">{output.attribute}</span>
                      </div>
                      <span className="settings-signal__type">{output.type}</span>
                      {output.options && output.options.length > 0 && (
                        <span className="settings-signal__options">
                          {output.options.map((option) => option.title).join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RecordsView({
  object,
  dataVersion,
  onRowClick,
  setError
}: {
  object: SchemaObject;
  dataVersion: number;
  onRowClick?: (record: RecordPreview) => void;
  setError: (error: string | null) => void;
}) {
  const [records, setRecords] = useState<RecordPreview[]>([]);
  const [signals, setSignals] = useState<SignalDefinitionSummary[]>([]);
  const [signalFailures, setSignalFailures] = useState<SignalRunFailureSummary[]>([]);
  const [signalRuns, setSignalRuns] = useState<SignalRunJob[]>([]);

  const loadRecords = useCallback(async () => {
    try {
      const [nextRecords, nextSignals, nextSignalFailures, nextSignalRuns] = await Promise.all([
        api.listRecords(object.object_slug),
        api.listSignals(),
        api.listSignalFailures(),
        api.listSignalRuns()
      ]);
      setRecords(nextRecords);
      setSignals(nextSignals);
      setSignalFailures(nextSignalFailures);
      setSignalRuns(nextSignalRuns);
    } catch (err) {
      setError(statusFromError(err));
    }
  }, [object.object_slug, setError]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords, dataVersion]);

  const valueColumns = pickValueColumns(object, records, signals);
  const failureBySignal = useMemo(
    () => signalFailureMap(signalFailures, signals),
    [signalFailures, signals],
  );
  const runningBySignal = useMemo(
    () => signalRunningMap(signalRuns, signals),
    [signalRuns, signals],
  );
  const [retryingSignals, setRetryingSignals] = useState<Set<string>>(() => new Set());
  const retrySignal = useCallback(
    async (failure: SignalRunFailureSummary) => {
      const key = signalRunKey(failure);
      if (retryingSignals.has(key)) return;
      setRetryingSignals((current) => new Set(current).add(key));
      try {
        await api.runSignals({
          mode: "missing",
          signalSlugs: [failure.signal_slug],
          object_slug: failure.object_slug,
          record_ids: [failure.record_id],
          concurrency: 1
        });
        await loadRecords();
      } catch (err) {
        setError(statusFromError(err));
      } finally {
        setRetryingSignals((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [loadRecords, retryingSignals, setError],
  );
  const hasRunningSignalCells = records.some((record) =>
    valueColumns.some(
      (column) =>
        column.isSignal &&
        runningBySignal.has(`${record.object_slug}:${record.record_id}:${column.slug}`),
    ),
  );

  useEffect(() => {
    if (!hasRunningSignalCells) return;
    const timer = window.setInterval(() => {
      void loadRecords();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasRunningSignalCells, loadRecords]);

  if (records.length === 0 && RECORDS_EMPTY_STATES[object.object_slug]) {
    return <RecordsEmptyState slug={object.object_slug} />;
  }

  return (
    <div className="table">
      <RecordsTable
        object={object}
        records={records}
        valueColumns={valueColumns}
        failureBySignal={failureBySignal}
        runningBySignal={runningBySignal}
        retryingSignals={retryingSignals}
        onRetrySignal={retrySignal}
        onRowClick={onRowClick}
      />
    </div>
  );
}

type RecordsEmptyConfig = {
  marks: string[];
  cols: [string, string, string];
  markShape: "square" | "circle";
  title: string;
  body: string;
  comment: string;
};

const RECORDS_EMPTY_STATES: Record<string, RecordsEmptyConfig> = {
  companies: {
    marks: ["a", "r", "v"],
    cols: ["company", "domain", "linkedin"],
    markShape: "square",
    title: "Companies",
    body: "The accounts in your world — design partners, customers, prospects.",
    comment: "run the onboarding skill — Claude will ask a few questions, then pull in your companies"
  },
  people: {
    marks: ["a", "b", "c"],
    cols: ["name", "email", "company"],
    markShape: "circle",
    title: "People",
    body: "The humans behind the accounts — champions, decision makers, the person who replied last Tuesday.",
    comment: "run the onboarding skill — Claude will ask a few questions, then pull in your people"
  },
  deals: {
    marks: ["$", "$", "$"],
    cols: ["deal", "stage", "value"],
    markShape: "square",
    title: "Deals",
    body: "The pipeline you're working — eval, trial, expansion, anything you call a stage.",
    comment: "run the onboarding skill — Claude will ask a few questions, then draft your pipeline"
  }
};

function RecordsEmptyState({ slug }: { slug: string }) {
  const config = RECORDS_EMPTY_STATES[slug];
  if (!config) return null;
  return (
    <div className="records-empty">
      <div className="records-empty__inner">
        <SchemaTablePreview
          marks={config.marks}
          cols={config.cols}
          markShape={config.markShape}
        />
        <h2 className="records-empty__title">{config.title}</h2>
        <p className="records-empty__body">{config.body}</p>
        <div className="records-empty__cli">
          <CliBlock comment={config.comment} command="/acrm-onboard" />
        </div>
      </div>
    </div>
  );
}

function SchemaTablePreview({
  marks,
  cols,
  markShape
}: {
  marks: string[];
  cols: [string, string, string];
  markShape: "square" | "circle";
}) {
  const markClass =
    markShape === "circle" ? "schema-table__mark schema-table__mark--circle" : "schema-table__mark";
  return (
    <div className="schema-table">
      <div className="schema-table__head">
        <span>{cols[0]}</span>
        <span>{cols[1]}</span>
        <span>{cols[2]}</span>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="schema-table__row" data-step={i}>
          <span className="schema-table__identity">
            <span className={markClass}>{marks[i] ?? "·"}</span>
            <span className="schema-table__bar" />
          </span>
          <span className="schema-table__bar--cell" />
          <span className="schema-table__dot" />
        </div>
      ))}
    </div>
  );
}

function CliBlock({ comment, command }: { comment: string; command: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return (
    <div className="cli-block">
      <div className="cli-block__body">
        <div className="cli-block__comment">{comment}</div>
        <div className="cli-block__cmd">
          <span className="cli-block__accent">{command}</span>
        </div>
      </div>
      <button type="button" className="cli-block__copy" onClick={onCopy}>
        {copied ? "copied" : "copy"}
      </button>
    </div>
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

type ValueColumn = {
  slug: string;
  title: string;
  isSignal: boolean;
  signalSlug?: string;
};

function pickValueColumns(
  object: SchemaObject,
  records: RecordPreview[],
  signals: SignalDefinitionSummary[],
) {
  const signalOutputs = signals
    .filter((signal) => signal.object_slug === object.object_slug)
    .flatMap((signal) => signal.outputs);
  const override = COLUMNS_BY_OBJECT[object.object_slug];
  if (override) {
    const seen = new Set(override.map(([slug]) => slug));
    const columns: ValueColumn[] = override.map(([slug, title]) => ({
      slug,
      title,
      isSignal: false
    }));
    for (const output of signalOutputs) {
      if (seen.has(output.attribute)) continue;
      columns.push({
        slug: output.attribute,
        title: output.title,
        isSignal: true,
        signalSlug: signals.find((signal) => signal.outputs.includes(output))?.slug
      });
      seen.add(output.attribute);
    }
    return columns;
  }
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
  for (const output of signalOutputs) {
    if (!seen.has(output.attribute)) {
      seen.set(output.attribute, output.title);
    }
  }
  const skip = new Set(["name", "primary_email", "full_name", "title"]);
  const signalAttrs = new Set(signalOutputs.map((output) => output.attribute));
  return Array.from(seen.entries())
    .filter(([slug]) => !skip.has(slug))
    .slice(0, 3)
    .map(([slug, title]) => ({
      slug,
      title,
      isSignal: signalAttrs.has(slug) || records.some((record) =>
        record.values.some((value) => value.attribute_slug === slug && isSignalValue(value)),
      ),
      signalSlug: signalOutputs.find((output) => output.attribute === slug)
        ? signals.find((signal) =>
            signal.outputs.some((output) => output.attribute === slug),
          )?.slug
        : undefined
    }));
}

function signalFailureMap(
  failures: SignalRunFailureSummary[],
  signals: SignalDefinitionSummary[],
) {
  const bySignal = new Map(signals.map((signal) => [signal.slug, signal]));
  const out = new Map<string, SignalRunFailureSummary>();
  for (const failure of failures) {
    const signal = bySignal.get(failure.signal_slug);
    if (!signal) continue;
    for (const output of signal.outputs) {
      out.set(`${failure.object_slug}:${failure.record_id}:${output.attribute}`, failure);
    }
  }
  return out;
}

function signalRunningMap(
  runs: SignalRunJob[],
  signals: SignalDefinitionSummary[],
) {
  const out = new Set<string>();
  for (const run of runs) {
    if (run.record_ids.length === 0) continue;
    const signalSlugs = run.signalSlugs.length ? new Set(run.signalSlugs) : null;
    for (const signal of signals) {
      if (run.object_slug && signal.object_slug !== run.object_slug) continue;
      if (signalSlugs && !signalSlugs.has(signal.slug)) continue;
      for (const recordId of run.record_ids) {
        for (const output of signal.outputs) {
          out.add(`${signal.object_slug}:${recordId}:${output.attribute}`);
        }
      }
    }
  }
  return out;
}

function signalRunKey(failure: Pick<SignalRunFailureSummary, "object_slug" | "record_id" | "signal_slug">) {
  return `${failure.object_slug}:${failure.record_id}:${failure.signal_slug}`;
}

const columnHelper = createColumnHelper<RecordPreview>();

function SignalColumnHeader({ title }: { title: string }) {
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
  return (
    <span className="signal-column-head">
      <span>{title}</span>
      <span
        className="signal-column-head__icon"
        aria-label="Signals are derived from your data through web search"
        onMouseEnter={(event) => setTooltipRect(event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setTooltipRect(null)}
        onFocus={(event) => setTooltipRect(event.currentTarget.getBoundingClientRect())}
        onBlur={() => setTooltipRect(null)}
        tabIndex={0}
      >
        <Zap size={12} className="lucide" aria-hidden="true" />
      </span>
      {tooltipRect && (
        <span
          className="signal-column-tooltip"
          style={{
            left: Math.min(tooltipRect.left, window.innerWidth - 390),
            top: tooltipRect.bottom + 8
          }}
        >
          Signals are derived from your data through web search
        </span>
      )}
    </span>
  );
}

function useRecordColumns(
  object: SchemaObject,
  valueColumns: ValueColumn[],
  failureBySignal: Map<string, SignalRunFailureSummary>,
  runningBySignal: Set<string>,
  retryingSignals: Set<string>,
  onRetrySignal?: (failure: SignalRunFailureSummary) => void,
  openSignalCell?: string | null,
  setOpenSignalCell?: Dispatch<SetStateAction<string | null>>,
  signalPopoverTabs?: Record<string, SignalPopoverTab>,
  setSignalPopoverTabs?: Dispatch<SetStateAction<Record<string, SignalPopoverTab>>>,
) {
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
        meta: { width: "minmax(220px, max-content)" }
      }),
      ...valueColumns.map((column) =>
        columnHelper.accessor(
          (record) => record.values.find((value) => value.attribute_slug === column.slug),
          {
            id: column.slug,
            header: () =>
              column.isSignal ? (
                <SignalColumnHeader title={column.title} />
              ) : (
                column.title
            ),
            cell: (info) => {
              const signalCellKey = `${info.row.original.object_slug}:${info.row.original.record_id}:${column.slug}`;
              const signalFailure = column.isSignal
                ? failureBySignal.get(signalCellKey)
                : undefined;
              const signalRunning = column.isSignal && runningBySignal.has(signalCellKey);
              return (
                <ValueCell
                  value={info.getValue() as RecordValue | undefined}
                  pendingSignal={column.isSignal}
                  runningSignal={signalRunning}
                  signalFailure={signalFailure}
                  retryingSignal={signalFailure ? retryingSignals.has(signalRunKey(signalFailure)) : false}
                  onRetrySignal={signalFailure ? () => onRetrySignal?.(signalFailure) : undefined}
                  signalPopoverOpen={openSignalCell === signalCellKey}
                  signalPopoverTab={signalPopoverTabs?.[signalCellKey] ?? "sources"}
                  onSignalPopoverTabChange={column.isSignal
                    ? (tab) => setSignalPopoverTabs?.((current) => ({ ...current, [signalCellKey]: tab }))
                    : undefined}
                  onSignalPopoverOpen={column.isSignal ? () => setOpenSignalCell?.(signalCellKey) : undefined}
                  onSignalPopoverClose={column.isSignal
                    ? () => setOpenSignalCell?.((current) => current === signalCellKey ? null : current)
                    : undefined}
                />
              );
            },
            meta: { width: column.isSignal ? "minmax(150px, 190px)" : "minmax(140px, 210px)" }
          }
        )
      )
    ];
    return cols;
  }, [failureBySignal, object, onRetrySignal, openSignalCell, retryingSignals, runningBySignal, setOpenSignalCell, setSignalPopoverTabs, signalPopoverTabs, valueColumns]);
}

function RecordsTable({
  object,
  records,
  valueColumns,
  failureBySignal,
  runningBySignal,
  retryingSignals,
  onRetrySignal,
  onRowClick
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: ValueColumn[];
  failureBySignal: Map<string, SignalRunFailureSummary>;
  runningBySignal: Set<string>;
  retryingSignals: Set<string>;
  onRetrySignal?: (failure: SignalRunFailureSummary) => void;
  onRowClick?: (record: RecordPreview) => void;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [openSignalCell, setOpenSignalCell] = useState<string | null>(null);
  const [signalPopoverTabs, setSignalPopoverTabs] = useState<Record<string, SignalPopoverTab>>({});
  const columns = useRecordColumns(
    object,
    valueColumns,
    failureBySignal,
    runningBySignal,
    retryingSignals,
    onRetrySignal,
    openSignalCell,
    setOpenSignalCell,
    signalPopoverTabs,
    setSignalPopoverTabs,
  );

  useEffect(() => {
    setSelectedCell(null);
    setExpandedCell(null);
    setOpenSignalCell(null);
    setSignalPopoverTabs({});
  }, [object.object_slug]);

  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (record) => `${record.object_slug}:${record.record_id}`
  });

  const columnTemplate =
    table
      .getVisibleLeafColumns()
      .map((column) => (column.columnDef.meta as { width?: string } | undefined)?.width ?? "1fr")
      .join(" ") + " 1fr";
  const gridStyle = { ["--columns" as string]: columnTemplate };

  return (
    <div className="table__inner" style={gridStyle}>
      {table.getHeaderGroups().map((headerGroup) => (
        <div key={headerGroup.id} className="table__head">
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
            >
              {row.getVisibleCells().map((cell, cellIndex, cells) => {
                const isIdentity = cell.column.id === "identity";
                const key = `${row.id}:${cell.column.id}`;
                const text = cellText(cell.column.id, cell.getValue(), row.original);
                const expanded = expandedCell === key;
                const nearRightEdge = cellIndex >= cells.length - 2;
                return (
                  <span
                    key={cell.id}
                    className={`table__cell${isIdentity ? " table__cell--identity" : ""}`}
                    data-selected={!isIdentity && selectedCell === key ? "true" : undefined}
                    data-expanded={expanded ? "true" : undefined}
                    data-edge-x={nearRightEdge ? "right" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isIdentity) {
                        onRowClick?.(row.original);
                      } else {
                        setSelectedCell(key);
                        setExpandedCell(null);
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (!isIdentity && text) {
                        setSelectedCell(key);
                        setExpandedCell(key);
                      }
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext()) as ReactNode}
                    {expanded && (
                      <textarea
                        className="table-cell-editor"
                        value={text}
                        readOnly
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onBlur={() => setExpandedCell(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setExpandedCell(null);
                        }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function cellText(columnId: string, raw: unknown, record: RecordPreview): string {
  if (columnId === "identity") return record.label;
  if (raw && typeof raw === "object" && "display" in raw) {
    const value = raw as RecordValue;
    return value.display ?? "";
  }
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return "";
}

function IdentityMark({ object, name }: { object: SchemaObject; name: string }) {
  if (object.object_slug === "people") return <Avatar name={name} size={20} />;
  if (object.object_slug === "companies") return <CompanyMark name={name} size={20} />;
  return <CompanyMark name={`${object.singular_name} ${name}`} size={20} />;
}

function ValueCell({
  value,
  pendingSignal = false,
  runningSignal = false,
  signalFailure,
  retryingSignal = false,
  onRetrySignal,
  signalPopoverOpen = false,
  signalPopoverTab = "sources",
  onSignalPopoverTabChange,
  onSignalPopoverOpen,
  onSignalPopoverClose
}: {
  value?: RecordValue;
  pendingSignal?: boolean;
  runningSignal?: boolean;
  signalFailure?: SignalRunFailureSummary;
  retryingSignal?: boolean;
  onRetrySignal?: () => void;
  signalPopoverOpen?: boolean;
  signalPopoverTab?: SignalPopoverTab;
  onSignalPopoverTabChange?: (tab: SignalPopoverTab) => void;
  onSignalPopoverOpen?: () => void;
  onSignalPopoverClose?: () => void;
}) {
  if (!value || !value.display) {
    if (runningSignal || retryingSignal) {
      return (
        <span className="signal-pending">
          <Loader2 size={11} className="lucide spin" />
          <span>calculating</span>
        </span>
      );
    }
    if (signalFailure) {
      return (
        <span className="signal-failed" title={signalFailureTitle(signalFailure)}>
          <X size={11} className="lucide" />
          <span>failed</span>
          {onRetrySignal && (
            <button
              type="button"
              className="signal-retry"
              disabled={retryingSignal}
              onClick={(event) => {
                event.stopPropagation();
                onRetrySignal();
              }}
            >
              {retryingSignal ? "running" : "run again"}
            </button>
          )}
        </span>
      );
    }
    if (pendingSignal) {
      return <span className="table__cell--muted">—</span>;
    }
    return <span className="table__cell--muted">—</span>;
  }
  if (isSignalValue(value)) {
    return (
      <SignalValueCell
        value={value}
        open={signalPopoverOpen}
        tab={signalPopoverTab}
        onTabChange={onSignalPopoverTabChange}
        onOpen={onSignalPopoverOpen}
        onClose={onSignalPopoverClose}
      />
    );
  }
  if (looksLikeStage(value)) return <Badge kind={stageKind(value.display)} dot>{value.display}</Badge>;
  if (looksMono(value)) return <span className="table__cell--mono">{value.display}</span>;
  return <span className="table__cell--muted">{value.display}</span>;
}

function signalFailureTitle(failure: SignalRunFailureSummary) {
  return [
    failure.message,
    failure.stdout_excerpt ? `stdout: ${failure.stdout_excerpt}` : "",
    failure.stderr_excerpt ? `stderr: ${failure.stderr_excerpt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function SignalValueCell({
  value,
  open,
  tab,
  onTabChange,
  onOpen,
  onClose
}: {
  value: RecordValue;
  open: boolean;
  tab: SignalPopoverTab;
  onTabChange?: (tab: SignalPopoverTab) => void;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openPopover = () => {
    cancelClose();
    onOpen?.();
  };

  const closePopoverSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      onClose?.();
      closeTimer.current = null;
    }, 180);
  };

  return (
    <span
      className="signal-cell"
      data-open={open ? "true" : undefined}
      onMouseEnter={openPopover}
      onMouseLeave={closePopoverSoon}
      onFocus={openPopover}
      onBlur={closePopoverSoon}
    >
      <span className="signal-value">
        <span>{shortSignalDisplay(value.display)}</span>
      </span>
      <span
        className="signal-popover"
        onMouseEnter={openPopover}
        onMouseLeave={closePopoverSoon}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="signal-popover__tabs" role="tablist" aria-label={`${value.title} provenance`}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sources"}
            onClick={() => onTabChange?.("sources")}
          >
            Sources
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "reasoning"}
            onClick={() => onTabChange?.("reasoning")}
          >
            Reasoning
          </button>
        </span>
        <span className="signal-popover__panel">
          {tab === "sources" ? (
            <SignalSources value={value} />
          ) : (
            <SignalReasoning value={value} />
          )}
        </span>
      </span>
    </span>
  );
}

function isSignalValue(value: RecordValue) {
  return typeof value.source === "string" && value.source.startsWith("signal:");
}

function shortSignalDisplay(value: string) {
  const words = value.trim().split(/\s+/);
  if (words.length <= 7 && value.length <= 48) return value;
  return `${words.slice(0, 7).join(" ")}…`;
}

function SignalSources({ value }: { value: RecordValue }) {
  const provenance = value.provenance ?? {};
  const citations = citationItems(provenance.citations);
  if (citations.length === 0) {
    return <span className="signal-popover__empty">No sources stored</span>;
  }
  return (
    <span className="signal-source-list">
      {citations.map((citation, index) => (
        <a
          key={`${citation.url}-${index}`}
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="signal-source"
        >
          <span className="signal-source__favicon">{faviconLetter(citation)}</span>
          <span>
            <span className="signal-source__domain">{domainFromUrl(citation.url)}</span>
            <span className="signal-source__title">{citation.title || citation.url}</span>
          </span>
        </a>
      ))}
    </span>
  );
}

function SignalReasoning({ value }: { value: RecordValue }) {
  const provenance = value.provenance ?? {};
  const reasoning = typeof provenance.reasoning === "string" ? provenance.reasoning : "";
  const notes = typeof provenance.notes === "string" ? provenance.notes : "";
  return (
    <span className="signal-reasoning">
      {reasoning || "No reasoning stored"}
      {notes && <span className="signal-reasoning__notes">{notes}</span>}
    </span>
  );
}

function faviconLetter(citation: { title: string; url: string }) {
  const domain = domainFromUrl(citation.url);
  return (citation.title || domain || "?").slice(0, 1).toUpperCase();
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

function RecordDetail({
  object,
  record
}: {
  object: SchemaObject;
  record: RecordPreview;
}) {
  const meta = record.subtitle && record.subtitle !== object.singular_name ? record.subtitle : null;
  const [signals, setSignals] = useState<SignalDefinitionSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSignals(null);
    api.listSignals()
      .then((nextSignals) => {
        if (!cancelled) setSignals(nextSignals);
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [object.object_slug]);

  const signalAttributes = useMemo(
    () =>
      new Set(
        (signals ?? [])
          .filter((signal) => signal.object_slug === object.object_slug)
          .flatMap((signal) => signal.outputs.map((output) => output.attribute)),
      ),
    [object.object_slug, signals],
  );
  const signalValues = record.values.filter(
    (value) =>
      signals !== null &&
      value.display &&
      isSignalValue(value) &&
      signalAttributes.has(value.attribute_slug),
  );
  const otherValues = record.values.filter(
    (value) => value.display && !isSignalValue(value) && value.attribute_slug !== "name",
  );

  return (
    <div className="detail">
      <header className="detail__header">
        <h1 className="detail__title display">{record.label}</h1>
        {meta && <div className="detail__meta">{meta}</div>}
      </header>

      <div className="record-detail">
        <section className="record-detail__section">
          <div className="record-detail__label">
            <MonoLabel>Signals</MonoLabel>
            <Zap size={12} className="lucide" />
          </div>
          {signalValues.length === 0 ? (
            <div className="empty-inline">
              <span>no signal values on this record yet</span>
            </div>
          ) : (
            <div className="record-fields">
              {signalValues.map((value) => (
                <RecordField key={value.attribute_slug} value={value} />
              ))}
            </div>
          )}
        </section>

        <aside className="record-detail__aside">
          <MonoLabel>Fields</MonoLabel>
          {otherValues.length === 0 ? (
            <div className="empty-inline">
              <span>no other fields on file</span>
            </div>
          ) : (
            <div className="record-fields">
              {otherValues.map((value) => (
                <RecordField key={value.attribute_slug} value={value} compact />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RecordField({ value, compact = false }: { value: RecordValue; compact?: boolean }) {
  const isSignal = isSignalValue(value);
  return (
    <div className="record-field" data-signal={isSignal ? "true" : undefined}>
      <div className="record-field__label">
        <span>{value.title}</span>
        {isSignal && <Info size={12} className="lucide" />}
      </div>
      <div className="record-field__value">
        <ValueCell value={value} />
      </div>
      {isSignal && !compact && <SignalProvenance value={value} />}
    </div>
  );
}

function SignalProvenance({ value }: { value: RecordValue }) {
  const provenance = value.provenance ?? {};
  const reasoning = typeof provenance.reasoning === "string" ? provenance.reasoning : "";
  const confidence = typeof provenance.confidence === "string" ? provenance.confidence : "";
  const ranAt = typeof provenance.ran_at === "string" ? provenance.ran_at : "";
  const notes = typeof provenance.notes === "string" ? provenance.notes : "";
  const citations = citationItems(provenance.citations);
  return (
    <div className="signal-provenance">
      {(confidence || ranAt) && (
        <div className="signal-provenance__meta">
          {[confidence ? `confidence ${confidence}` : "", ranAt ? `ran ${formatDateDisplay(ranAt)}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {reasoning && <p>{reasoning}</p>}
      {notes && <p className="signal-provenance__notes">{notes}</p>}
      {citations.length > 0 && (
        <div className="signal-provenance__citations">
          {citations.map((citation, index) => (
            <a key={`${citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer">
              {citation.title || citation.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function citationItems(raw: unknown): Array<{ title: string; url: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((citation) => {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) return [];
    const item = citation as Record<string, unknown>;
    const url = typeof item.url === "string" ? item.url : "";
    if (!url) return [];
    return [{
      title: typeof item.title === "string" ? item.title : "",
      url
    }];
  });
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
