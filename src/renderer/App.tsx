import {
  Building2,
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
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
  CloudIntegrationsStatus,
  CloudSyncStatus,
  IntegrationAccountSummary,
  IntegrationProviderStatus,
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
import agentCrmLogo from "./assets/agent-crm-bg.png";
import packageJson from "../../package.json";

const sdkObjectOrder = [
  "companies",
  "people",
  "deals",
  "communication_threads",
  "communication_messages",
  "posts",
  "transcripts"
];
const SIDEBAR_VISIBLE_OBJECTS = new Set(["companies", "people", "deals"]);
const appVersion = packageJson.version;
const appDisplayVersion = displayVersion(appVersion);

type PersonTab = "overview" | "messages" | "transcripts" | "posts";
type SignalPopoverTab = "sources" | "reasoning";
type MainView = "records" | "settings";
type SettingsTab = "signals" | "integrations";

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
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailRecord, setDetailRecord] = useState<RecordPreview | null>(null);
  const [personTab, setPersonTab] = useState<PersonTab>("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({ state: "idle" });
  const previousWorkspacePathRef = useRef<string | null>(null);

  useEffect(() => {
    return api.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    return api.onCloudSyncStatus(setCloudSyncStatus);
  }, []);

  useEffect(() => {
    setDetailRecord(null);
  }, [selectedObjectSlug]);

  useEffect(() => {
    setPersonTab("overview");
  }, [detailRecord?.record_id]);

  useEffect(() => {
    const nextPath = workspace?.path ?? null;
    const previousPath = previousWorkspacePathRef.current;
    previousWorkspacePathRef.current = nextPath;

    if (!nextPath) {
      setTerminalOpen(false);
      return;
    }

    if (nextPath !== previousPath) {
      setTerminalOpen(true);
    }
  }, [workspace?.path]);

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

      if (mainView === "settings") {
        event.preventDefault();
        setMainView("records");
        return;
      }

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
  }, [detailRecord, mainView, personTab]);

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
          <img className="workspace-logo" src={agentCrmLogo} alt="Agent CRM" />
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
                    setDetailRecord(null);
                    setPersonTab("overview");
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

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-footer__settings"
            aria-current={mainView === "settings"}
            onClick={() => setMainView("settings")}
          >
            <Settings size={14} className="lucide" />
            <span>Settings</span>
          </button>

          <div className="sidebar-footer__divider" aria-hidden="true" />

          <div className="sidebar-footer__content">
            <div
              className="sidebar-footer__status"
              title={workspace ? workspace.filename : "No workspace"}
            >
              <span
                className="sidebar-footer__dot"
                data-state={workspace ? "live" : "idle"}
              />
              <span>agent-crm v{appDisplayVersion}</span>
            </div>
            <UpdateBanner status={updateStatus} appVersion={appVersion} />
          </div>
        </div>
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
                key={selectedObject.object_slug}
                object={selectedObject}
                dataVersion={dataVersion}
                totalRecords={workspace.counts[selectedObject.object_slug] ?? 0}
                cloudSyncStatus={cloudSyncStatus}
                onRowClick={setDetailRecord}
                setError={setError}
              />
            ) : null}
          </div>
          {terminalOpen && (
            <TerminalPane
              visible={terminalOpen}
              cwd={workspace?.path}
              width={terminalWidth}
              onWidthChange={setTerminalWidth}
              onClose={() => setTerminalOpen(false)}
              setError={setError}
            />
          )}
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

function UpdateBanner({ status, appVersion }: { status: UpdateStatus; appVersion: string }) {
  if (status.state === "idle" || status.state === "checking" || status.state === "error") {
    return null;
  }

  const isReady = status.state === "ready";
  const version =
    status.state === "available" || status.state === "downloading" || status.state === "ready"
      ? status.version
      : appVersion;
  const label =
    status.state === "available"
      ? "Update"
      : status.state === "downloading"
        ? "Downloading"
        : "Restart";
  const detail = status.state === "downloading" ? `${status.percent}%` : `v${displayVersion(version)}`;

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
      <span className="update-banner__label">{label}</span>
      <span className="update-banner__version">{detail}</span>
    </button>
  );
}

function displayVersion(version: string): string {
  return version.split("-")[0] ?? version;
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("signals");
  const [signals, setSignals] = useState<SignalDefinitionSummary[] | null>(null);
  const [integrations, setIntegrations] = useState<CloudIntegrationsStatus | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setIntegrations(null);
    api.getCloudIntegrations()
      .then((status) => {
        if (!cancelled) setIntegrations(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setIntegrations({ state: "error", message: statusFromError(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const connectedIntegrations = integrations?.state === "ready"
    ? Object.values(integrations.integrations).filter((integration) => integration.connected).length
    : 0;

  return (
    <div className="detail settings-view">
      <header className="detail__header">
        <h1 className="detail__title display">Settings</h1>
      </header>

      <nav className="detail__tabs tabs">
        <button
          type="button"
          className="tab"
          aria-current={activeTab === "signals" ? "true" : undefined}
          onClick={() => setActiveTab("signals")}
        >
          Signals
          {signals && <span className="tab__count">{signals.length}</span>}
        </button>
        <button
          type="button"
          className="tab"
          aria-current={activeTab === "integrations" ? "true" : undefined}
          onClick={() => setActiveTab("integrations")}
        >
          Integrations
          {integrations?.state === "ready" && connectedIntegrations > 0 && (
            <span className="tab__count">{connectedIntegrations}</span>
          )}
        </button>
      </nav>

      {activeTab === "signals" ? (
        <section className="settings-panel">
          {signals === null ? (
            <div className="empty-inline">
              <Loader2 size={14} className="lucide spin" />
              <span>loading signals</span>
            </div>
          ) : signals.length === 0 ? (
            <SignalsEmptyState />
          ) : (
            <>
              <p className="settings-panel__description">
                Signals are configured in the <code>/signals</code> directory of your workspace. They automatically fill in data about a company or person using a background web search with Claude. Use the <code>/create-signals</code> signals skill to create one or learn more.
              </p>
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
            </>
          )}
        </section>
      ) : (
        <IntegrationsSettingsPanel integrations={integrations} />
      )}
    </div>
  );
}

function SignalsEmptyState() {
  return (
    <div className="signals-empty">
      <div className="signals-empty__ghost" aria-hidden="true">
        <div className="signals-empty-card">
          <div className="signals-empty-card__header">
            <span className="signals-empty-card__chip">company_signal</span>
            <span className="signals-empty-card__status" />
          </div>
          <div className="signals-empty-card__body">
            <div className="signals-empty-card__row" data-wide="true">
              <span />
              <span />
            </div>
            <div className="signals-empty-card__row">
              <span />
              <span />
            </div>
            <div className="signals-empty-card__row" data-short="true">
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>

      <h2>Let Claude research your prospects</h2>
      <p>
        Signals allow Claude to scrape the web for prospect information relevant to your
        business. Every time you import a record Claude runs in the background with{" "}
        <code>claude -p</code> based on the prompt configured by the{" "}
        <code>/create-signals</code> skill.
      </p>
      <p>
        Define what you want, and every record gets enriched.
      </p>

      <div className="signals-empty__cli">
        <CliBlock
          comment="define a new signal interactively"
          command="/create-signals for hotels in companies research whether they offer breakfast"
        />
      </div>
    </div>
  );
}

function IntegrationsSettingsPanel({
  integrations
}: {
  integrations: CloudIntegrationsStatus | null;
}) {
  if (integrations === null) {
    return (
      <section className="settings-panel">
        <div className="empty-inline">
          <Loader2 size={14} className="lucide spin" />
          <span>loading integrations</span>
        </div>
      </section>
    );
  }

  if (integrations.state === "no_workspace") {
    return (
      <section className="settings-panel">
        <div className="empty-inline">
          <span>open a workspace to view integrations</span>
        </div>
      </section>
    );
  }

  if (integrations.state === "error") {
    return (
      <section className="settings-panel">
        <div className="empty-inline">
          <span>{integrations.message}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-panel">
      <div className="settings-integrations">
        <IntegrationProviderRow
          title="Gmail"
          channel="email"
          status={integrations.integrations.gmail}
        />
        <IntegrationProviderRow
          title="LinkedIn"
          channel="linkedin"
          status={integrations.integrations.linkedin}
        />
      </div>
    </section>
  );
}

function IntegrationProviderRow({
  title,
  channel,
  status
}: {
  title: string;
  channel: "email" | "linkedin";
  status: IntegrationProviderStatus;
}) {
  const accounts = integrationAccounts(status);
  return (
    <article className="settings-integration">
      <header className="settings-integration__header">
        <div className="settings-integration__provider">
          <span className="settings-integration__icon">
            <ChannelMark channel={channel} size={24} />
          </span>
          <div className="settings-integration__title">
            <h2>{title}</h2>
            <span>{status.connected ? "Connected" : "Not connected"}</span>
          </div>
        </div>
        <Badge kind={status.connected ? "success" : "neutral"}>
          {status.connected ? "connected" : "not connected"}
        </Badge>
      </header>
      {accounts.length > 0 && (
        <div className="settings-integration__accounts">
          {accounts.map((account, index) => (
            <div className="settings-integration__account" key={`${accountLabel(account, title)}-${index}`}>
              <span className="settings-integration__account-name">
                {accountLabel(account, title)}
              </span>
              <span className="settings-integration__account-meta">
                {accountMeta(account)}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function integrationAccounts(status: IntegrationProviderStatus): IntegrationAccountSummary[] {
  if (status.accounts && status.accounts.length > 0) return status.accounts;
  if (!status.connected) return [];
  return [{
    accountEmail: status.accountEmail,
    displayName: status.displayName,
    providerAccountId: status.providerAccountId,
    lastSyncedAt: status.lastSyncedAt
  }];
}

function accountLabel(account: IntegrationAccountSummary, fallback: string): string {
  return account.displayName ?? account.accountEmail ?? account.providerAccountId ?? fallback;
}

function accountMeta(account: IntegrationAccountSummary): string {
  const parts = [
    account.accountEmail,
    account.lastSyncedAt ? `last sync ${formatDateDisplay(account.lastSyncedAt)}` : undefined
  ].filter((part): part is string => Boolean(part));
  return [...new Set(parts)].join(" · ");
}

function RecordsView({
  object,
  dataVersion,
  totalRecords,
  cloudSyncStatus,
  onRowClick,
  setError
}: {
  object: SchemaObject;
  dataVersion: number;
  totalRecords: number;
  cloudSyncStatus: CloudSyncStatus;
  onRowClick?: (record: RecordPreview) => void;
  setError: (error: string | null) => void;
}) {
  const pageSize = 100;
  const [records, setRecords] = useState<RecordPreview[]>([]);
  const [signals, setSignals] = useState<SignalDefinitionSummary[]>([]);
  const [signalFailures, setSignalFailures] = useState<SignalRunFailureSummary[]>([]);
  const [signalRuns, setSignalRuns] = useState<SignalRunJob[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const requestIdRef = useRef(0);
  const [retryingSignals, setRetryingSignals] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setRecords([]);
    setSignals([]);
    setSignalFailures([]);
    setSignalRuns([]);
    setLoadingRecords(true);
    setHasMore(false);
    setNextCursor(null);
    setPageIndex(0);
    setPageCursors([null]);
  }, [object.object_slug]);

  const loadRecords = useCallback(async (options: { quiet?: boolean } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.quiet) {
      setLoadingRecords(true);
    }
    try {
      const [nextSignals, nextSignalFailures, nextSignalRuns] = await Promise.all([
        api.listSignals(),
        api.listSignalFailures(),
        api.listSignalRuns()
      ]);
      const requestedColumns = pickValueColumns(object, [], nextSignals);
      const result = await api.listRecords(object.object_slug, {
        limit: pageSize,
        cursor: pageCursors[pageIndex] ?? null,
        valueAttributes: requestedColumns.map((column) => column.slug)
      });
      if (requestId !== requestIdRef.current) return;
      if (result.objectSlug !== object.object_slug) return;
      setRecords(result.records);
      setSignals(nextSignals);
      setSignalFailures(nextSignalFailures);
      setSignalRuns(nextSignalRuns);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(statusFromError(err));
    } finally {
      if (requestId === requestIdRef.current && !options.quiet) {
        setLoadingRecords(false);
      }
    }
  }, [object, pageCursors, pageIndex, setError]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords, dataVersion]);

  const valueColumns = useMemo(
    () => pickValueColumns(object, records, signals),
    [object, records, signals],
  );
  const failureBySignal = useMemo(
    () => signalFailureMap(signalFailures, signals),
    [signalFailures, signals],
  );
  const runningBySignal = useMemo(
    () => signalRunningMap(signalRuns, signals),
    [signalRuns, signals],
  );
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
        await loadRecords({ quiet: true });
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
      void loadRecords({ quiet: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasRunningSignalCells, loadRecords]);

  function goToPreviousPage() {
    setPageIndex((index) => Math.max(0, index - 1));
  }

  function goToNextPage() {
    if (!nextCursor) return;
    setPageCursors((cursors) => {
      const next = cursors.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((index) => index + 1);
  }

  if (totalRecords === 0 && RECORDS_EMPTY_STATES[object.object_slug]) {
    return (
      <RecordsEmptyState
        slug={object.object_slug}
        syncStatus={!loadingRecords ? cloudSyncStatus : null}
      />
    );
  }

  const pageStart = records.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + records.length;

  return (
    <div className="table">
      <div className="table-toolbar">
        <div className="table-toolbar__meta">
          {loadingRecords ? (
            <>
              <Loader2 size={13} className="lucide spin" />
              <span>Loading {object.plural_name.toLowerCase()}</span>
            </>
          ) : (
            <span>
              {formatNumber(pageStart)}-{formatNumber(pageEnd)} of {formatNumber(totalRecords)}
            </span>
          )}
        </div>
        <div className="table-toolbar__pager">
          <button
            type="button"
            className="icon-btn"
            title="Previous page"
            aria-label="Previous page"
            disabled={pageIndex === 0 || loadingRecords}
            onClick={goToPreviousPage}
          >
            <ChevronLeft size={14} className="lucide" />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Next page"
            aria-label="Next page"
            disabled={!hasMore || loadingRecords}
            onClick={goToNextPage}
          >
            <ChevronRight size={14} className="lucide" />
          </button>
        </div>
      </div>
      <RecordsTable
        object={object}
        records={records}
        valueColumns={valueColumns}
        failureBySignal={failureBySignal}
        runningBySignal={runningBySignal}
        retryingSignals={retryingSignals}
        onRetrySignal={retrySignal}
        onRowClick={onRowClick}
        loading={loadingRecords}
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

const ACRM_ONBOARDING_PROMPT = "Onboard me into Agent CRM for this workspace";

const RECORDS_EMPTY_STATES: Record<string, RecordsEmptyConfig> = {
  companies: {
    marks: ["a", "r", "v"],
    cols: ["company", "domain", "linkedin"],
    markShape: "square",
    title: "Companies",
    body: "The accounts in your world — design partners, customers, prospects.",
    comment: "Paste this into Claude Code to kickoff onboarding"
  },
  people: {
    marks: ["a", "b", "c"],
    cols: ["name", "email", "company"],
    markShape: "circle",
    title: "People",
    body: "The humans behind the accounts — champions, decision makers, the person who replied last Tuesday.",
    comment: "Paste this into Claude Code to kickoff onboarding"
  },
  deals: {
    marks: ["$", "$", "$"],
    cols: ["deal", "stage", "value"],
    markShape: "square",
    title: "Deals",
    body: "The pipeline you're working — eval, trial, expansion, anything you call a stage.",
    comment: "Paste this into Claude Code to kickoff onboarding"
  }
};

function RecordsEmptyState({
  slug,
  syncStatus
}: {
  slug: string;
  syncStatus: CloudSyncStatus | null;
}) {
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
          <CliBlock comment={config.comment} command={ACRM_ONBOARDING_PROMPT} />
        </div>
        <RecordsEmptySyncStatus status={syncStatus} />
      </div>
    </div>
  );
}

function RecordsEmptySyncStatus({ status }: { status: CloudSyncStatus | null }) {
  const statusText = cloudSyncStatusText(status);
  if (!statusText) return null;
  const isError = status?.state === "error";
  return (
    <div
      className={`records-empty__sync${isError ? " records-empty__sync--error" : ""}`}
      role={isError ? "alert" : "status"}
      aria-live="polite"
    >
      {isError ? (
        <CircleAlert size={13} className="lucide" />
      ) : (
        <Loader2 size={13} className="lucide spin" />
      )}
      <span>{statusText}</span>
    </div>
  );
}

function cloudSyncStatusText(status: CloudSyncStatus | null): string | null {
  if (!status) return null;
  if (status.state === "error") return status.message || "Gmail sync failed";
  if (status.state !== "syncing") return null;
  const providers = status.providers ?? [];
  const hasGmail = providers.includes("gmail");
  const hasLinkedIn = providers.includes("linkedin");
  if (hasGmail && hasLinkedIn) return "Syncing Gmail and LinkedIn";
  if (hasGmail) return "Syncing Gmail";
  if (hasLinkedIn) return "Syncing LinkedIn";
  return "Syncing integrations";
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
            meta: { width: column.isSignal ? "minmax(150px, max-content)" : "minmax(140px, max-content)" }
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
  onRowClick,
  loading
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: ValueColumn[];
  failureBySignal: Map<string, SignalRunFailureSummary>;
  runningBySignal: Set<string>;
  retryingSignals: Set<string>;
  onRetrySignal?: (failure: SignalRunFailureSummary) => void;
  onRowClick?: (record: RecordPreview) => void;
  loading: boolean;
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

  useEffect(() => {
    if (!openSignalCell) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenSignalCell(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSignalCell]);

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
        {records.length === 0 && !loading ? (
          <div className="empty-inline">
            <span>no records yet · run an import or create one</span>
          </div>
        ) : null}
        {records.length > 0
          ? table.getRowModel().rows.map((row, index) => (
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
          : null}
        {loading ? <TableSkeleton columnCount={columns.length} /> : null}
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

function TableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 10 }).map((_, rowIndex) => (
        <div key={rowIndex} className="table__row table__row--skeleton">
          {Array.from({ length: columnCount }).map((__, columnIndex) => (
            <span key={columnIndex}>
              <span
                className="table-skeleton-bar"
                data-column={columnIndex === 0 ? "select" : undefined}
              />
            </span>
          ))}
        </div>
      ))}
    </>
  );
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
        <button
          type="button"
          className="signal-value__trigger"
          title="Show provenance"
          aria-label={`Show provenance for ${value.title}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            openPopover();
          }}
        >
          <ChevronDown size={12} className="lucide" />
        </button>
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
      // Shift+Enter → Ctrl+J: Claude Code treats LF as "insert newline".
      if (shift && !meta && !ctrl && !alt && event.key === "Enter") {
        bridge.send(sessionId, "\x0a");
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
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

type CommunicationChannel = "email" | "linkedin" | "other";
type CommunicationDirection = "inbound" | "outbound" | "unknown";

type CommunicationMessage = RelatedRecord & {
  senderLabel: string;
  recipientLabels: string[];
};

type CommunicationThread = RelatedRecord & {
  messages: CommunicationMessage[];
  unread: boolean;
};

async function fetchAssociated(
  personRecordId: string,
  childObject: "transcripts" | "posts" | "communication_threads",
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
      pushAttrValue(entry.attrs, String(row.attr), parseValueJson(row.val));
    }
  }
  return [...map.values()];
}

async function fetchCommunicationThreads(personRecordId: string): Promise<CommunicationThread[]> {
  const threads = await fetchAssociated(
    personRecordId,
    "communication_threads",
    "communication_threads"
  );
  return initializeCommunicationThreads(threads);
}

async function hydrateCommunicationThreads(
  threads: CommunicationThread[]
): Promise<CommunicationThread[]> {
  const loaded = await Promise.all(
    threads.map(async (thread) => {
      const messages = await fetchThreadMessages(thread.id);
      return {
        ...thread,
        messages,
        unread: messages.some(messageIsUnread)
      };
    })
  );
  return sortCommunicationThreads(loaded);
}

function initializeCommunicationThreads(threads: RelatedRecord[]): CommunicationThread[] {
  return sortCommunicationThreads(
    threads.map((thread) => ({
      ...thread,
      messages: [],
      unread: false
    }))
  );
}

function sortCommunicationThreads(threads: CommunicationThread[]): CommunicationThread[] {
  return [...threads].sort((a, b) =>
    communicationThreadSortValue(b).localeCompare(communicationThreadSortValue(a))
  );
}

async function fetchThreadMessages(threadRecordId: string): Promise<CommunicationMessage[]> {
  const result = await api.runQuery(
    `SELECT v.record_id AS rec_id,
            mv.attribute_slug AS attr,
            mv.value_json AS val,
            mv.ref_object AS ref_object,
            mv.ref_record_id AS ref_record_id
       FROM acrm_value v
       LEFT JOIN acrm_value mv
         ON mv.object_slug = 'communication_messages'
        AND mv.record_id = v.record_id
        AND mv.active_until IS NULL
      WHERE v.object_slug = 'communication_messages'
        AND v.attribute_slug = 'thread'
        AND v.ref_object = 'communication_threads'
        AND v.ref_record_id = $1
        AND v.active_until IS NULL`,
    [threadRecordId]
  );

  const map = new Map<string, RelatedRecord>();
  const peopleRefs = new Set<string>();
  for (const row of result.rows) {
    const id = row.rec_id == null ? "" : String(row.rec_id);
    if (!id) continue;
    let entry = map.get(id);
    if (!entry) {
      entry = { id, attrs: {} };
      map.set(id, entry);
    }
    if (row.attr == null) continue;
    const attr = String(row.attr);
    const ref = row.ref_record_id && row.ref_object
      ? { target_object: String(row.ref_object), target_record_id: String(row.ref_record_id) }
      : null;
    const parsed = ref ?? parseValueJson(row.val);
    pushAttrValue(entry.attrs, attr, parsed);
    if (ref?.target_object === "people") {
      peopleRefs.add(ref.target_record_id);
    }
  }

  const peopleLabels = await fetchRecordLabels("people", [...peopleRefs]);
  return [...map.values()]
    .map((item) => {
      const senderId = getRecordRefIds(item.attrs, "sender")[0] ?? "";
      const recipientIds = getRecordRefIds(item.attrs, "recipients");
      const senderFallback =
        getScalar(item.attrs, "sender") ||
        getScalar(item.attrs, "from") ||
        getScalar(item.attrs, "from_email") ||
        getScalar(item.attrs, "sender_email");
      return {
        ...item,
        senderLabel: peopleLabels.get(senderId) ?? senderFallback,
        recipientLabels: recipientIds.map((id) => peopleLabels.get(id) ?? id.slice(0, 8))
      };
    })
    .sort((a, b) => getScalar(a.attrs, "sent_at").localeCompare(getScalar(b.attrs, "sent_at")));
}

async function fetchRecordLabels(objectSlug: "people", recordIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(recordIds.filter(Boolean))];
  if (unique.length === 0) return labels;
  const where = unique.map((_, index) => `record_id = $${index + 1}`).join(" OR ");
  const result = await api.runQuery(
    `SELECT record_id, attribute_slug, value_json
       FROM acrm_value
      WHERE object_slug = '${objectSlug}'
        AND active_until IS NULL
        AND (${where})
        AND attribute_slug IN ('name', 'email_addresses', 'linkedin_url')`,
    unique
  );
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of result.rows) {
    const id = row.record_id == null ? "" : String(row.record_id);
    const attr = row.attribute_slug == null ? "" : String(row.attribute_slug);
    if (!id || !attr) continue;
    const attrs = grouped.get(id) ?? {};
    pushAttrValue(attrs, attr, parseValueJson(row.value_json));
    grouped.set(id, attrs);
  }
  for (const id of unique) {
    const attrs = grouped.get(id) ?? {};
    labels.set(
      id,
      getScalar(attrs, "name") ||
        getScalar(attrs, "email_addresses") ||
        stripUrl(getScalar(attrs, "linkedin_url")) ||
        id.slice(0, 8)
    );
  }
  return labels;
}

function pushAttrValue(attrs: Record<string, unknown>, key: string, value: unknown) {
  const existing = attrs[key];
  if (existing === undefined) {
    attrs[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    attrs[key] = [existing, value];
  }
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
  if (Array.isArray(value)) return value.map((item) => displayUnknown(item)).filter(Boolean).join(", ");
  return displayUnknown(value);
}

function displayUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidate =
      obj.full_name ??
      obj.value ??
      obj.title ??
      obj.timestamp ??
      obj.date ??
      obj.text ??
      obj.url ??
      obj.email_address ??
      obj.domain ??
      obj.root_domain;
    if (candidate != null) return String(candidate);
  }
  return "";
}

function getStringArray(attrs: Record<string, unknown>, key: string): string[] {
  const value = attrs[key];
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(displayUnknown).filter(Boolean);
}

function getRecordRefIds(attrs: Record<string, unknown>, key: string): string[] {
  const value = attrs[key];
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const ref = item as Record<string, unknown>;
    return typeof ref.target_record_id === "string" ? [ref.target_record_id] : [];
  });
}

function communicationChannel(attrs: Record<string, unknown>): CommunicationChannel {
  const channel = getScalar(attrs, "channel").toLowerCase();
  if (channel === "email" || channel === "linkedin") return channel;
  return "other";
}

function communicationDirection(attrs: Record<string, unknown>): CommunicationDirection {
  const direction = getScalar(attrs, "direction").toLowerCase();
  if (direction === "inbound" || direction === "outbound") return direction;
  return "unknown";
}

function communicationThreadSortValue(thread: CommunicationThread): string {
  return getScalar(thread.attrs, "last_message_at") ||
    getScalar(thread.messages.at(-1)?.attrs ?? {}, "sent_at") ||
    "";
}

function messageIsUnread(message: CommunicationMessage): boolean {
  return getStringArray(message.attrs, "label_ids").some((label) => label.toLowerCase() === "unread");
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

function formatDateTimeDisplay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDateDisplay(iso);
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60]
  ];
  const [unit, ms] = units.find(([, unitMs]) => abs >= unitMs) ?? ["minute", 1000 * 60];
  const value = Math.round(diffMs / ms);
  if (value === 0) return "now";
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit);
}

function truncateText(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
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

  const [communicationThreads, setCommunicationThreads] = useState<CommunicationThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messageChannel, setMessageChannel] = useState<CommunicationChannel | "all" | "unread">("all");
  const [transcripts, setTranscripts] = useState<RelatedRecord[]>([]);
  const [posts, setPosts] = useState<RelatedRecord[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [relatedError, setRelatedError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedThreadId(null);
  }, [record.record_id, tab]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRelated(true);
    setRelatedError(null);
    setCommunicationThreads([]);

    fetchCommunicationThreads(record.record_id)
      .then((threads) => {
        if (cancelled) return;
        setCommunicationThreads(threads);
        return hydrateCommunicationThreads(threads);
      })
      .then((hydratedThreads) => {
        if (cancelled || !hydratedThreads) return;
        setCommunicationThreads(hydratedThreads);
      })
      .catch((err) => {
        if (!cancelled) setRelatedError(statusFromError(err));
      });

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

  const filteredThreads = useMemo(() => {
    if (messageChannel === "all") return communicationThreads;
    if (messageChannel === "unread") return communicationThreads.filter((thread) => thread.unread);
    return communicationThreads.filter((thread) => communicationChannel(thread.attrs) === messageChannel);
  }, [communicationThreads, messageChannel]);
  const selectedThread =
    communicationThreads.find((thread) => thread.id === selectedThreadId) ?? null;

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
          aria-current={tab === "messages"}
          onClick={() => onTabChange("messages")}
        >
          Messages <span className="tab__count">{communicationThreads.length}</span>
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
              <span>no activity yet · messages, agent runs, and transcripts will appear here</span>
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
                  row.href ? (
                    <a key={index} className="detail__contact-row detail__contact-link" href={row.href} target="_blank" rel="noreferrer">
                      <row.Icon size={13} className="lucide" />
                      <span className="mono">{row.value}</span>
                    </a>
                  ) : (
                    <div key={index} className="detail__contact-row">
                      <row.Icon size={13} className="lucide" />
                      <span className="mono">{row.value}</span>
                    </div>
                  )
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
          ) : tab === "messages" ? (
            selectedThread ? (
              <MessageThreadView
                person={record}
                thread={selectedThread}
                onBack={() => setSelectedThreadId(null)}
              />
            ) : (
              <MessagesList
                person={record}
                threads={filteredThreads}
                allThreads={communicationThreads}
                active={messageChannel}
                onActive={setMessageChannel}
                onSelect={(thread) => setSelectedThreadId(thread.id)}
              />
            )
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

function MessagesList({
  person,
  threads,
  allThreads,
  active,
  onActive,
  onSelect
}: {
  person: RecordPreview;
  threads: CommunicationThread[];
  allThreads: CommunicationThread[];
  active: CommunicationChannel | "all" | "unread";
  onActive: (next: CommunicationChannel | "all" | "unread") => void;
  onSelect: (thread: CommunicationThread) => void;
}) {
  const segments: Array<{ id: CommunicationChannel | "all" | "unread"; label: string; count: number }> = [
    { id: "all", label: "All", count: allThreads.length },
    {
      id: "email",
      label: "Email",
      count: allThreads.filter((thread) => communicationChannel(thread.attrs) === "email").length
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      count: allThreads.filter((thread) => communicationChannel(thread.attrs) === "linkedin").length
    },
    { id: "unread", label: "Unread", count: allThreads.filter((thread) => thread.unread).length }
  ];

  return (
    <div className="messages-panel">
      <div className="messages-subhead">
        <div className="messages-segmented" role="tablist" aria-label="Message channel">
          {segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              className="messages-segment"
              aria-selected={active === segment.id}
              onClick={() => onActive(segment.id)}
            >
              <span>{segment.label}</span>
              <span className="messages-segment__count">{segment.count}</span>
            </button>
          ))}
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="empty-inline">
          <span>no messages linked to this person yet</span>
        </div>
      ) : (
        <div className="messages-list">
          {threads.map((thread, index) => (
            <MessageThreadRow
              key={thread.id}
              person={person}
              thread={thread}
              last={index === threads.length - 1}
              onClick={() => onSelect(thread)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageThreadRow({
  person,
  thread,
  last,
  onClick
}: {
  person: RecordPreview;
  thread: CommunicationThread;
  last: boolean;
  onClick: () => void;
}) {
  const latest = thread.messages.at(-1);
  const channel = communicationChannel(thread.attrs);
  const title =
    getScalar(thread.attrs, "subject") ||
    getScalar(latest?.attrs ?? {}, "subject") ||
    (channel === "linkedin" ? "LinkedIn conversation" : "Email thread");
  const preview =
    getScalar(thread.attrs, "snippet") ||
    getScalar(latest?.attrs ?? {}, "snippet") ||
    getScalar(latest?.attrs ?? {}, "body_text");
  const latestAt =
    getScalar(thread.attrs, "last_message_at") ||
    getScalar(latest?.attrs ?? {}, "sent_at");
  const from = latest
    ? communicationDirection(latest.attrs) === "outbound"
      ? latest.recipientLabels.length > 0
        ? `to ${latest.recipientLabels.join(", ")}`
        : "sent"
      : latest.senderLabel || person.label
    : channelLabel(channel);

  return (
    <button
      type="button"
      className="message-row"
      data-last={last ? "true" : undefined}
      data-unread={thread.unread ? "true" : undefined}
      onClick={onClick}
    >
      <span className="message-row__unread">
        {thread.unread && <span />}
      </span>
      <ChannelMark channel={channel} />
      <span className="message-row__content">
        <span className="message-row__line">
          <span className="message-row__from">{from}</span>
          <span className="message-row__dot">·</span>
          <span className="message-row__subject">{title}</span>
        </span>
        <span className="message-row__preview">{truncateText(preview || "no preview available", 180)}</span>
      </span>
      <span className="message-row__time">{formatRelativeTime(latestAt)}</span>
    </button>
  );
}

function MessageThreadView({
  person,
  thread,
  onBack
}: {
  person: RecordPreview;
  thread: CommunicationThread;
  onBack: () => void;
}) {
  const channel = communicationChannel(thread.attrs);
  const count = Number(getScalar(thread.attrs, "message_count")) || thread.messages.length;
  const title =
    getScalar(thread.attrs, "subject") ||
    getScalar(thread.messages[0]?.attrs ?? {}, "subject") ||
    (channel === "linkedin" ? `LinkedIn conversation with ${person.label}` : "Email thread");
  const participantLabels = uniqueStrings([
    person.label,
    ...thread.messages.flatMap((message) => [messageSenderLabel(message, person), ...message.recipientLabels])
  ]).slice(0, 6);

  return (
    <div className="message-thread">
      <header className="message-thread__header">
        <button type="button" className="message-thread__back" onClick={onBack}>
          <ChevronLeft size={13} className="lucide" />
          Messages
        </button>
        <div className="message-thread__eyebrow">
          <ChannelMark channel={channel} size={18} />
          <span>
            {channelLabel(channel)} thread · {count} message{count === 1 ? "" : "s"}
          </span>
        </div>
        <h2 className="message-thread__title display">{title}</h2>
        {participantLabels.length > 0 && (
          <div className="message-thread__participants">{participantLabels.join(" · ")}</div>
        )}
      </header>

      <div className="message-thread__body">
        {thread.messages.length === 0 ? (
          <div className="empty-inline">
            <span>no messages found for this thread</span>
          </div>
        ) : (
          thread.messages.map((message) => (
            <ThreadMessageCard key={message.id} message={message} person={person} />
          ))
        )}

      </div>
    </div>
  );
}

function ThreadMessageCard({
  message,
  person
}: {
  message: CommunicationMessage;
  person: RecordPreview;
}) {
  const [expanded, setExpanded] = useState(false);
  const direction = communicationDirection(message.attrs);
  const from = messageSenderLabel(message, person);
  const sentAt = getScalar(message.attrs, "sent_at");
  const body = normalizeEmailBody(getScalar(message.attrs, "body_text") || getScalar(message.attrs, "snippet"));
  const paragraphs = body ? body.split(/\n{2,}/).filter((paragraph) => paragraph.trim()) : [];
  const expandable = body.length > 900 || paragraphs.length > 4;

  return (
    <article className="thread-message" data-direction={direction}>
      <div className="thread-message__head">
        <Avatar name={from} size={26} />
        <div className="thread-message__sender">
          <span>{from}</span>
          <span>{direction === "outbound" ? "sent" : "received"}</span>
        </div>
        <time className="thread-message__time">{formatDateTimeDisplay(sentAt)}</time>
      </div>
      <div
        className="thread-message__body"
        data-collapsed={expandable && !expanded ? "true" : undefined}
      >
        {body ? (
          paragraphs.map((paragraph, index) => (
            <p key={index}>{linkifyText(paragraph)}</p>
          ))
        ) : (
          <p className="thread-message__empty">No body text saved for this message.</p>
        )}
      </div>
      {expandable && (
        <button
          type="button"
          className="thread-message__expand"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      )}
    </article>
  );
}

function messageSenderLabel(message: CommunicationMessage, person: RecordPreview): string {
  const direction = communicationDirection(message.attrs);
  return message.senderLabel || (direction === "outbound" ? "You" : person.label);
}

function linkifyText(text: string): ReactNode[] {
  const htmlAnchorParts = renderHtmlAnchors(text);
  if (htmlAnchorParts) return htmlAnchorParts;

  const parts: ReactNode[] = [];
  const parenthesizedUrlPattern = /\((https?:\/\/[^)\s]+)\)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = parenthesizedUrlPattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    const linkText = extractTrailingLinkText(before);
    const prefix = linkText ? before.slice(0, before.length - linkText.raw.length) : before;
    parts.push(...linkifyStandaloneUrls(prefix, parts.length));

    const rawUrl = match[1];
    const { href } = trimUrlSuffix(rawUrl);
    parts.push(
      <a key={`linked-${match.index}`} href={href} target="_blank" rel="noreferrer">
        {linkText?.label || domainFromUrl(href) || "Open link"}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(...linkifyStandaloneUrls(text.slice(lastIndex), parts.length));
  }
  return parts;
}

function renderHtmlAnchors(text: string): ReactNode[] | null {
  if (!/<a\s/i.test(text)) return null;
  const parts: ReactNode[] = [];
  const anchorPattern = /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(text)) !== null) {
    parts.push(...linkifyText(stripHtmlTags(text.slice(lastIndex, match.index))));
    const href = normalizeLinkHref(decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? ""));
    const label = normalizeEmailBody(stripHtmlTags(match[4])).trim() || domainFromUrl(href) || "Open link";
    parts.push(
      <a key={`html-anchor-${match.index}`} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(...linkifyText(stripHtmlTags(text.slice(lastIndex))));
  return parts;
}

function linkifyStandaloneUrls(text: string, keyOffset = 0): ReactNode[] {
  const parts: ReactNode[] = [];
  const urlPattern = /https?:\/\/[^\s<>"')]+/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const { href, suffix } = trimUrlSuffix(match[0]);
    parts.push(
      <a key={`url-${keyOffset}-${match.index}`} href={href} target="_blank" rel="noreferrer">
        {domainFromUrl(href) || "Open link"}
      </a>
    );
    if (suffix) parts.push(suffix);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function extractTrailingLinkText(text: string): { raw: string; label: string } | null {
  const trailing = text.match(/([^\n.!?;:]+?)\s*$/);
  if (!trailing) return null;
  const raw = trailing[0];
  const label = trailing[1].trim();
  if (!label) return null;
  if (label.length <= 120) return { raw, label };

  const action = label.match(
    /(?:^|\s)((?:RSVP|Register|Sign up|Join us|Learn more|Read more|View details|Book now|Apply now|Get tickets|Open|here|this link)(?:\s+now)?)$/i
  );
  if (action) return { raw: action[0], label: action[1] };
  return null;
}

function trimUrlSuffix(url: string): { href: string; suffix: string } {
  let href = url;
  let suffix = "";
  while (/[),.;:!?]$/.test(href)) {
    suffix = href[href.length - 1] + suffix;
    href = href.slice(0, -1);
  }
  return { href, suffix };
}

function normalizeLinkHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "#";
  if (/^(?:https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return externalUrl(trimmed);
}

function normalizeEmailBody(raw: string): string {
  return decodeHtmlEntities(decodeQuotedPrintable(raw))
    .replace(/\u00a0/g, " ")
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n\n")
    .replace(/<(?!\/?a\b)[^>]+>/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeQuotedPrintable(raw: string): string {
  if (!/=[0-9A-F]{2}|=\r?\n/i.test(raw)) return raw;
  const input = raw.replace(/=\r?\n/g, "");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length === 0) return;
    out += decoder.decode(new Uint8Array(bytes));
    bytes = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const hex = input.slice(i + 1, i + 3);
    if (char === "=" && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

function decodeHtmlEntities(raw: string): string {
  if (!/[&][a-z#0-9]+;/i.test(raw)) return raw;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = raw;
  return textarea.value;
}

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function ChannelMark({
  channel,
  size = 18
}: {
  channel: CommunicationChannel;
  size?: number;
}) {
  return (
    <span
      className="channel-mark"
      data-channel={channel}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.55) }}
      title={channelLabel(channel)}
    >
      <span className="channel-mark__glyph">
        {channel === "linkedin" ? "in" : channel === "email" ? "@" : "?"}
      </span>
    </span>
  );
}

function channelLabel(channel: CommunicationChannel): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin") return "LinkedIn";
  return "Message";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
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
  href?: string;
};

function buildContactRows(record: RecordPreview): ContactRow[] {
  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  const push = (Icon: ContactRow["Icon"], value: string, href?: string) => {
    const key = `${Icon.name}:${value}:${href ?? ""}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ Icon, value, href });
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
        push(LinkedInIcon, stripUrl(display), externalUrl(display));
        break;
      case "twitter_url":
      case "x_url":
        push(XIcon, stripUrl(display), externalUrl(display));
        break;
      case "github_url":
      case "github":
        push(GitHubIcon, stripUrl(display), externalUrl(display));
        break;
      case "website":
      case "url":
      case "domain":
      case "domains":
        push(Globe, stripUrl(display), externalUrl(display));
        break;
      default:
        if (/github\.com/i.test(display)) {
          push(GitHubIcon, stripUrl(display), externalUrl(display));
        } else if (/linkedin\.com/i.test(display)) {
          push(LinkedInIcon, stripUrl(display), externalUrl(display));
        } else if (/(?:^|\W)(?:x\.com|twitter\.com)/i.test(display)) {
          push(XIcon, stripUrl(display), externalUrl(display));
        }
        break;
    }
  }
  return rows;
}

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function externalUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
