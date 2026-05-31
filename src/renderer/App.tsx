import {
  Building2,
  Check,
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
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
  Paperclip,
  Phone,
  Search,
  Settings,
  Table2,
  Terminal,
  Users,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComponentType,
  Dispatch,
  DragEvent as ReactDragEvent,
  FormEvent as ReactFormEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
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
  AgentCliPreflightStatus,
  CloudIntegrationsStatus,
  CloudSyncStatus,
  IntegrationAccountSummary,
  IntegrationProviderStatus,
  RecordPreview,
  RecordValue,
  RecentWorkspaceSummary,
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
  SegmentedControl,
  XIcon
} from "./primitives";
import agentCrmLogo from "./assets/agent-crm-bg.png";
import agentCrmWhiteLogo from "./assets/white-logo.png";
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
const DEFAULT_EMPTY_RECORD_OBJECTS = ["companies", "people", "deals"] as const;
const appVersion = packageJson.version;
const appDisplayVersion = displayVersion(appVersion);

type PersonTab = "overview" | "messages" | "transcripts" | "posts";
type CompanyTab = "overview" | "team" | "signals";
type SignalPopoverTab = "sources" | "reasoning";
type MainView = "records" | "settings";
type SettingsTab = "signals" | "integrations";
type DealsViewMode = "table" | "kanban";

const PERSON_TABS: PersonTab[] = ["overview", "messages", "transcripts", "posts"];
const COMPANY_TABS: CompanyTab[] = ["overview", "team", "signals"];
const RECORD_TABLE_PAGE_SIZE = 100;
const DEAL_RECORD_PAGE_SIZE = 250;
const WELCOME_WORKSPACE_CONTENTS = [
  { label: "Companies", icon: Building2 },
  { label: "People", icon: Users },
  { label: "Deals", icon: Handshake },
  { label: "Posts", icon: Newspaper },
  { label: "Transcripts", icon: FileText }
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function isTerminalTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".terminal") !== null;
}

function isTableRowNavigationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isTerminalTarget(target)) return false;
  if (target.closest(".table-filter")) return true;
  if (isEditableTarget(target)) return false;

  const row = target.closest(".table__row:not(.table__row--skeleton), .deals-table__row");
  if (!row) {
    return !target.closest("button, a, input, textarea, select, [contenteditable='true']");
  }
  const interactive = target.closest("button, a, input, textarea, select, [contenteditable='true']");
  return !interactive || interactive === row;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function statusFromError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function isDefaultRecordsWorkspaceEmpty(summary: WorkspaceSummary | null): boolean {
  if (!summary) return false;
  return DEFAULT_EMPTY_RECORD_OBJECTS.every((objectSlug) =>
    (summary.counts[objectSlug] ?? 0) === 0
  );
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
  const [companyTab, setCompanyTab] = useState<CompanyTab>("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({ state: "idle" });
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceSummary[]>([]);
  const previousWorkspacePathRef = useRef<string | null>(null);
  const sidebarItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [recordsFocusRequest, setRecordsFocusRequest] = useState(0);
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);

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
    setCompanyTab("overview");
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
    let cancelled = false;
    const load = () => {
      refreshWorkspace()
        .catch((err) => {
          if (cancelled) return;
          setError(statusFromError(err));
        })
        .finally(() => {
          if (!cancelled) setLoading("");
        });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    if (workspace) return;
    let cancelled = false;
    api.listRecentWorkspaces()
      .then((workspaces) => {
        if (!cancelled) setRecentWorkspaces(workspaces);
      })
      .catch(() => {
        if (!cancelled) setRecentWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshWorkspace()
          .then((summary) => {
            if (!isDefaultRecordsWorkspaceEmpty(summary)) return;
            return api.triggerCloudSync();
          })
          .then(() => setDataVersion((v) => v + 1))
          .catch((err) => {
            setError(statusFromError(err));
          });
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
  const sidebarObjects = useMemo(
    () => schemaObjects.filter((object) => SIDEBAR_VISIBLE_OBJECTS.has(object.object_slug)),
    [schemaObjects],
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

  const selectSidebarObject = useCallback((objectSlug: string, focus = false) => {
    setSelectedObjectSlug(objectSlug);
    setMainView("records");
    setDetailRecord(null);
    setPersonTab("overview");
    setCompanyTab("overview");
    if (focus) {
      window.requestAnimationFrame(() => {
        sidebarItemRefs.current.get(objectSlug)?.focus();
      });
    }
  }, []);

  const moveSidebarSelection = useCallback((delta: -1 | 1) => {
    if (sidebarObjects.length === 0) return;
    const currentIndex = Math.max(
      0,
      sidebarObjects.findIndex((object) => object.object_slug === selectedObjectSlug),
    );
    const nextIndex = Math.min(sidebarObjects.length - 1, Math.max(0, currentIndex + delta));
    const nextObject = sidebarObjects[nextIndex];
    if (!nextObject) return;
    selectSidebarObject(nextObject.object_slug, true);
  }, [selectSidebarObject, selectedObjectSlug, sidebarObjects]);

  useEffect(() => {
    if (!workspace || !sidebarOpen || mainView !== "records") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target) || isTerminalTarget(event.target)) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".sidebar")) return;
      if (!selectedObject || !SIDEBAR_VISIBLE_OBJECTS.has(selectedObject.object_slug)) return;
      if (detailRecord && selectedObject.object_slug === "people" && personTab !== "overview") return;

      event.preventDefault();
      sidebarItemRefs.current.get(selectedObject.object_slug)?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailRecord, mainView, personTab, selectedObject, sidebarOpen, workspace]);

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

  async function handleCreateWorkspace(name: string, databaseUrl: string) {
    setError(null);
    const summary = await api.createWorkspace(name, databaseUrl);
    if (summary) {
      setWorkspace(summary);
      setSelectedObjectSlug(defaultObjectSlug(orderSchemaObjects(summary.objects)));
      setMainView("records");
    }
  }

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
      } else if (key === "n") {
        if (createOpen || isEditableTarget(event.target)) return;
        event.preventDefault();
        setCreateOpen(true);
      } else if (key === "o") {
        if (createOpen || isEditableTarget(event.target)) return;
        event.preventDefault();
        setCreateOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createOpen]);

  const workspaceLabel = workspace?.filename ?? "No workspace";
  const createWorkspaceModal = createOpen && (
    <CreateWorkspaceModal
      onClose={() => setCreateOpen(false)}
      onCreate={handleCreateWorkspace}
    />
  );

  if (!workspace) {
    return (
      <div className="welcome-page" data-screen-label="Welcome">
        <div className="welcome-page__drag" aria-hidden="true" />

        {(error || loading) && (
          <div className="welcome-page__status">
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
          </div>
        )}

        <main className="welcome-page__main" aria-labelledby="welcome-title">
          <section className="welcome-hero">
            <img className="welcome-logo" src={agentCrmWhiteLogo} alt="Agent CRM" />

            <h1 id="welcome-title">Connect a database</h1>
            <p className="welcome-hero__sub">
              Give your agents one shared Postgres workspace for every company,
              person, deal, post and transcript they need to remember.
            </p>

            <div className="welcome-context" aria-label="What a workspace holds">
              <div className="welcome-context__label mono">What a workspace holds</div>
              <div className="welcome-context__chips">
                {WELCOME_WORKSPACE_CONTENTS.map(({ label, icon: Icon }) => (
                  <span className="welcome-context__chip" key={label}>
                    <Icon size={12} className="lucide" />
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="welcome-actions" aria-label="Workspace actions">
              <button
                className="welcome-action"
                type="button"
                onClick={() => setCreateOpen(true)}
              >
                <span className="welcome-action__icon">
                  <FolderOpen size={24} className="lucide" />
                </span>
                <span className="welcome-action__copy">
                  <span className="welcome-action__title">Open database</span>
                  <span className="welcome-action__sub">Paste a Postgres connection URL.</span>
                </span>
                <span className="welcome-action__kbd mono">⌘O</span>
              </button>

              <button
                className="welcome-action welcome-action--primary"
                type="button"
                onClick={() => setCreateOpen(true)}
              >
                <span className="welcome-action__icon">
                  <FilePlus2 size={24} className="lucide" />
                </span>
                <span className="welcome-action__copy">
                  <span className="welcome-action__title">Initialize database</span>
                  <span className="welcome-action__sub">Create the Agent CRM schema.</span>
                </span>
                <span className="welcome-action__kbd mono">⌘N</span>
              </button>
            </div>

            <div className="welcome-recents-wrap" aria-label="Recent workspaces">
              <div className="welcome-recents__label mono">Recent</div>
              {recentWorkspaces.length > 0 ? (
                <div className="welcome-recents">
                  {recentWorkspaces.map((recent) => (
                    <button
                      className="welcome-recent"
                      key={recent.databaseUrl}
                      type="button"
                      onClick={() => runWorkspaceAction(() => api.openWorkspace(recent.databaseUrl))}
                    >
                      <span className="welcome-recent__icon">
                        <FolderOpen size={18} className="lucide" />
                      </span>
                      <span className="welcome-recent__copy">
                        <span className="welcome-recent__title">{formatWorkspaceName(recent.filename)}</span>
                        <span className="welcome-recent__counts mono">{formatRecentWorkspaceCounts(recent.counts)}</span>
                      </span>
                      <span className="welcome-recent__time mono">{formatCompactRelativeTime(recent.lastOpenedAt)}</span>
                      <ChevronRight size={20} className="welcome-recent__chevron lucide" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="welcome-empty">
                  <span className="welcome-empty__icon">
                    <Database size={14} className="lucide" />
                  </span>
                  <span className="welcome-empty__copy">
                    <span className="welcome-empty__title">No workspaces yet</span>
                    <span className="welcome-empty__sub">Connect Neon, Supabase, or another Postgres database.</span>
                  </span>
                </div>
              )}
            </div>
          </section>
        </main>

        <footer className="welcome-footer mono">
          <span>agent-crm v{appDisplayVersion}</span>
          <span className="welcome-footer__ready">runtime ready</span>
        </footer>

        {createWorkspaceModal}
      </div>
    );
  }

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      <aside className="sidebar" hidden={!sidebarOpen}>
        <div className="traffic-space" />
        <div className="workspace-switcher">
          <img className="workspace-logo" src={agentCrmLogo} alt="Agent CRM" />
        </div>

        <div className="sidebar-section">
          {sidebarObjects.length > 0 ? (
            sidebarObjects.map((object) => {
              const Icon = iconForObject(object.object_slug);
              const active = mainView === "records" && selectedObject?.object_slug === object.object_slug;
              const count = workspace?.counts[object.object_slug] ?? 0;
              return (
                <button
                  type="button"
                  className="nav-item"
                  aria-current={active}
                  key={object.object_slug}
                  ref={(element) => {
                    if (element) sidebarItemRefs.current.set(object.object_slug, element);
                    else sidebarItemRefs.current.delete(object.object_slug);
                  }}
                  onClick={() => selectSidebarObject(object.object_slug)}
                  onKeyDown={(event) => {
                    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveSidebarSelection(1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveSidebarSelection(-1);
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      if (detailRecord) {
                        setDetailFocusRequest((request) => request + 1);
                      } else {
                        setRecordsFocusRequest((request) => request + 1);
                      }
                    }
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
          <CloudSyncStatusPill status={cloudSyncStatus} />
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
              <span className="sidebar-footer__workspace">{workspaceLabel}</span>
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
              className="icon-btn toolbar-tooltip"
              type="button"
              aria-label="Open database"
              onClick={() => setCreateOpen(true)}
            >
              <FolderOpen size={14} className="lucide" />
              <span className="toolbar-tooltip__bubble" role="tooltip">
                <kbd><span>⌘</span><span>O</span></kbd>
                <span>Open database</span>
              </span>
            </button>
            <button
              className="icon-btn toolbar-tooltip"
              type="button"
              aria-label="Initialize database"
              onClick={() => setCreateOpen(true)}
            >
              <FilePlus2 size={14} className="lucide" />
              <span className="toolbar-tooltip__bubble" role="tooltip">
                <kbd><span>⌘</span><span>N</span></kbd>
                <span>Initialize database</span>
              </span>
            </button>
            <button
              className="icon-btn toolbar-tooltip"
              type="button"
              aria-label="Terminal"
              aria-pressed={terminalOpen}
              onClick={() => setTerminalOpen((open) => !open)}
            >
              <Terminal size={14} className="lucide" />
              <span className="toolbar-tooltip__bubble" role="tooltip">
                <kbd><span>⌘</span><span>J</span></kbd>
                <span>Toggle shell</span>
              </span>
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
            {mainView === "settings" ? (
              <SettingsView dataVersion={dataVersion} setError={setError} />
            ) : detailRecord && selectedObject?.object_slug === "people" ? (
              <PersonDetail
                record={detailRecord}
                tab={personTab}
                focusRequest={detailFocusRequest}
                onTabChange={setPersonTab}
              />
            ) : detailRecord && selectedObject?.object_slug === "companies" ? (
              <CompanyDetail
                object={selectedObject}
                peopleObject={schemaObjects.find((object) => object.object_slug === "people")}
                record={detailRecord}
                tab={companyTab}
                focusRequest={detailFocusRequest}
                onTabChange={setCompanyTab}
              />
            ) : detailRecord && selectedObject ? (
              <RecordDetail
                object={selectedObject}
                record={detailRecord}
                focusRequest={detailFocusRequest}
              />
            ) : selectedObject ? (
              <RecordsView
                key={selectedObject.object_slug}
                object={selectedObject}
                dataVersion={dataVersion}
                totalRecords={workspace.counts[selectedObject.object_slug] ?? 0}
                onRowClick={setDetailRecord}
                focusRequest={recordsFocusRequest}
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
      {createWorkspaceModal}
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
  onCreate: (name: string, databaseUrl: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState("");
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
  const trimmedDatabaseUrl = databaseUrl.trim();
  const canSubmit = trimmed.length > 0 && trimmedDatabaseUrl.length > 0 && !submitting;

  async function handleSubmit(event: ReactFormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      await onCreate(trimmed, trimmedDatabaseUrl);
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
            <h2>Database workspace</h2>
            <p>Connect Neon, Supabase, or any Postgres-compatible database.</p>
          </div>
        </div>
        <div className="modal__body">
          <div className="workspace-form-stack">
            <label className="input">
              <input
                ref={inputRef}
                type="text"
                placeholder="Workspace name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting}
                autoComplete="off"
                spellCheck={false}
                maxLength={60}
              />
            </label>
            <label className="input">
              <input
                type="password"
                placeholder="postgres://user:password@host:5432/database"
                value={databaseUrl}
                onChange={(event) => setDatabaseUrl(event.target.value)}
                disabled={submitting}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
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
                <span>Connecting</span>
              </>
            ) : (
              <span>Connect</span>
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

function formatWorkspaceName(filename: string): string {
  return filename;
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function formatRecentWorkspaceCounts(counts: Record<string, number> | undefined): string {
  if (!counts) return "Recently opened workspace";
  return [
    formatCount(counts.companies ?? 0, "company", "companies"),
    formatCount(counts.people ?? 0, "person", "people"),
    formatCount(counts.deals ?? 0, "deal", "deals")
  ].join(" · ");
}

function formatCompactRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return "now";
  if (diffMs < 60 * 60 * 1000) return `${Math.round(diffMs / (60 * 1000))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.round(diffMs / (60 * 60 * 1000))}h ago`;
  if (diffMs < 48 * 60 * 60 * 1000) return "yesterday";
  return `${Math.round(diffMs / (24 * 60 * 60 * 1000))}d ago`;
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
        <IntegrationProviderRow
          title="Granola"
          channel="granola"
          status={integrations.integrations.granola}
        />
      </div>
    </section>
  );
}

type IntegrationProviderChannel = "email" | "linkedin" | "granola";

function IntegrationProviderRow({
  title,
  channel,
  status
}: {
  title: string;
  channel: IntegrationProviderChannel;
  status: IntegrationProviderStatus;
}) {
  const accounts = integrationAccounts(status);
  return (
    <article className="settings-integration">
      <header className="settings-integration__header">
        <div className="settings-integration__provider">
          <span className="settings-integration__icon">
            <IntegrationProviderMark channel={channel} />
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

function IntegrationProviderMark({ channel }: { channel: IntegrationProviderChannel }) {
  if (channel === "granola") {
    return (
      <span className="integration-mark" title="Granola">
        <FileText size={14} className="lucide" />
      </span>
    );
  }
  return <ChannelMark channel={channel} size={24} />;
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

type LoadRecordPageOptions = {
  quiet?: boolean;
  cursor: string | null;
  searchQuery: string;
};

function recordPreviewId(record: Pick<RecordPreview, "object_slug" | "record_id">): string {
  return `${record.object_slug}:${record.record_id}`;
}

function RecordsView({
  object,
  dataVersion,
  totalRecords,
  onRowClick,
  focusRequest,
  setError
}: {
  object: SchemaObject;
  dataVersion: number;
  totalRecords: number;
  onRowClick?: (record: RecordPreview) => void;
  focusRequest: number;
  setError: (error: string | null) => void;
}) {
  const [dealsViewMode, setDealsViewMode] = useState<DealsViewMode>("kanban");
  const viewMode = object.object_slug === "deals" ? dealsViewMode : "table";
  const isDealsView = object.object_slug === "deals";
  const tableFilterAvailable =
    object.object_slug === "companies" ||
    object.object_slug === "people" ||
    (object.object_slug === "deals" && viewMode === "table");
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedFilterQuery = normalizeTableFilterQuery(filterQuery);
  const debouncedFilterQuery = useDebouncedValue(
    tableFilterAvailable ? normalizedFilterQuery : "",
    90
  );
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const loadAllRecords = isDealsView;
  const pageSize = loadAllRecords ? DEAL_RECORD_PAGE_SIZE : RECORD_TABLE_PAGE_SIZE;
  const [records, setRecords] = useState<RecordPreview[]>([]);
  const [signals, setSignals] = useState<SignalDefinitionSummary[]>([]);
  const [signalFailures, setSignalFailures] = useState<SignalRunFailureSummary[]>([]);
  const [signalRuns, setSignalRuns] = useState<SignalRunJob[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalMatches, setTotalMatches] = useState<number | null>(null);
  const [loadedSearchQuery, setLoadedSearchQuery] = useState("");
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const requestIdRef = useRef(0);
  const recordsRef = useRef<RecordPreview[]>([]);
  const loadRequestContextRef = useRef({
    dataVersion,
    objectSlug: object.object_slug,
    searchQuery: debouncedFilterQuery
  });
  const [retryingSignals, setRetryingSignals] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    setRecords([]);
    setSignals([]);
    setSignalFailures([]);
    setSignalRuns([]);
    setLoadingRecords(true);
    setHasMore(false);
    setNextCursor(null);
    setTotalMatches(null);
    setLoadedSearchQuery("");
    setFocusedRecordId(null);
    setFocusRequestVersion(0);
    setPageIndex(0);
    setPageCursors([null]);
  }, [object.object_slug]);

  useEffect(() => {
    if (!tableFilterAvailable) return;
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "f") return;
      if (isTerminalTarget(event.target)) return;
      if (isEditableTarget(event.target) && event.target !== filterInputRef.current) return;
      event.preventDefault();
      window.requestAnimationFrame(() => {
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tableFilterAvailable]);

  const loadRecordPage = useCallback(async ({
    quiet = false,
    cursor,
    searchQuery
  }: LoadRecordPageOptions) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!quiet) {
      setLoadingRecords(true);
    }
    try {
      const [nextSignals, nextSignalFailures, nextSignalRuns] = await Promise.all([
        api.listSignals(),
        api.listSignalFailures(),
        api.listSignalRuns()
      ]);
      const requestedAttributes = requestedRecordAttributes(object, nextSignals);
      const includeSecondaryLabels =
        object.object_slug === "deals" ? true : !COLUMNS_BY_OBJECT[object.object_slug];
      if (loadAllRecords) {
        const allRecords: RecordPreview[] = [];
        let pageCursor: string | null = null;
        let more = false;
        let next: string | null = null;

        do {
          const result = await api.listRecords(object.object_slug, {
            limit: DEAL_RECORD_PAGE_SIZE,
            cursor: pageCursor,
            valueAttributes: requestedAttributes,
            includeSecondaryLabels,
            searchQuery: searchQuery || undefined
          });
          if (requestId !== requestIdRef.current) return;
          if (result.objectSlug !== object.object_slug) return;
          allRecords.push(...result.records);
          more = result.hasMore;
          next = result.nextCursor;
          pageCursor = result.nextCursor;
          setTotalMatches(searchQuery ? result.totalMatches ?? allRecords.length : null);
        } while (more && pageCursor);

        setRecords(allRecords);
        setSignals(nextSignals);
        setSignalFailures(nextSignalFailures);
        setSignalRuns(nextSignalRuns);
        setHasMore(more);
        setNextCursor(next);
        setTotalMatches(searchQuery ? allRecords.length : null);
        setLoadedSearchQuery(searchQuery);
        return;
      }
      const result = await api.listRecords(object.object_slug, {
        limit: pageSize,
        cursor,
        valueAttributes: requestedAttributes,
        includeSecondaryLabels,
        searchQuery: searchQuery || undefined
      });
      if (requestId !== requestIdRef.current) return;
      if (result.objectSlug !== object.object_slug) return;
      setRecords(result.records);
      setSignals(nextSignals);
      setSignalFailures(nextSignalFailures);
      setSignalRuns(nextSignalRuns);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      setTotalMatches(searchQuery ? result.totalMatches ?? result.records.length : null);
      setLoadedSearchQuery(searchQuery);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(statusFromError(err));
    } finally {
      if (requestId === requestIdRef.current && !quiet) {
        setLoadingRecords(false);
      }
    }
  }, [loadAllRecords, object, pageSize, setError]);

  const loadCurrentRecords = useCallback(
    (options: { quiet?: boolean } = {}) =>
      loadRecordPage({
        quiet: options.quiet,
        cursor: pageCursors[pageIndex] ?? null,
        searchQuery: debouncedFilterQuery
      }),
    [debouncedFilterQuery, loadRecordPage, pageCursors, pageIndex],
  );

  useEffect(() => {
    const previous = loadRequestContextRef.current;
    const filterOnlyChange =
      previous.objectSlug === object.object_slug &&
      previous.dataVersion === dataVersion &&
      previous.searchQuery !== debouncedFilterQuery;
    const suppressLoadingState =
      tableFilterAvailable && filterOnlyChange && recordsRef.current.length > 0;

    loadRequestContextRef.current = {
      dataVersion,
      objectSlug: object.object_slug,
      searchQuery: debouncedFilterQuery
    };

    if (!suppressLoadingState) {
      setLoadingRecords(true);
    }
    setHasMore(false);
    setNextCursor(null);
    setTotalMatches(null);
    setPageIndex(0);
    setPageCursors([null]);
    void loadRecordPage({
      cursor: null,
      quiet: suppressLoadingState,
      searchQuery: debouncedFilterQuery
    });
  }, [dataVersion, debouncedFilterQuery, loadRecordPage, object.object_slug, tableFilterAvailable]);

  const valueColumns = useMemo(
    () => pickValueColumns(object, records, signals),
    [object, records, signals],
  );
  const displayedRecords = useMemo(() => {
    if (!tableFilterAvailable) return records;
    if (normalizedFilterQuery === loadedSearchQuery) return records;
    return filterRecordsForQuery(records, filterQuery);
  }, [filterQuery, loadedSearchQuery, normalizedFilterQuery, records, tableFilterAvailable]);
  const displayedRecordIds = useMemo(
    () => displayedRecords.map(recordPreviewId),
    [displayedRecords],
  );

  useEffect(() => {
    setFocusedRecordId((current) => {
      if (displayedRecordIds.length === 0) return null;
      if (current && displayedRecordIds.includes(current)) return current;
      return displayedRecordIds[0];
    });
  }, [displayedRecordIds]);

  useEffect(() => {
    if (!tableFilterAvailable) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      if (!isTableRowNavigationTarget(event.target)) return;
      if (displayedRecords.length === 0) return;

      const currentIndex = focusedRecordId
        ? displayedRecordIds.indexOf(focusedRecordId)
        : -1;
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;

      if (event.key === "Enter") {
        event.preventDefault();
        onRowClick?.(displayedRecords[safeIndex]);
        return;
      }

      event.preventDefault();
      const nextIndex =
        event.key === "ArrowDown"
          ? Math.min(displayedRecords.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex < 0 ? displayedRecords.length - 1 : currentIndex - 1);
      setFocusedRecordId(displayedRecordIds[nextIndex]);
      setFocusRequestVersion((version) => version + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayedRecordIds, displayedRecords, focusedRecordId, onRowClick, tableFilterAvailable]);
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
        await loadCurrentRecords({ quiet: true });
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
    [loadCurrentRecords, retryingSignals, setError],
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
      void loadCurrentRecords({ quiet: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasRunningSignalCells, loadCurrentRecords]);

  function goToPreviousPage() {
    const nextIndex = Math.max(0, pageIndex - 1);
    setPageIndex(nextIndex);
    void loadRecordPage({
      cursor: pageCursors[nextIndex] ?? null,
      searchQuery: debouncedFilterQuery
    });
  }

  function goToNextPage() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    const nextIndex = pageIndex + 1;
    setPageCursors((cursors) => {
      const next = cursors.slice(0, pageIndex + 1);
      next[nextIndex] = cursor;
      return next;
    });
    setPageIndex(nextIndex);
    void loadRecordPage({ cursor, searchQuery: debouncedFilterQuery });
  }

  if (totalRecords === 0 && RECORDS_EMPTY_STATES[object.object_slug]) {
    return (
      <RecordsEmptyState slug={object.object_slug} />
    );
  }

  const filterActive = tableFilterAvailable && normalizedFilterQuery.length > 0;
  const optimisticFilter = filterActive && normalizedFilterQuery !== debouncedFilterQuery;
  const pageStart = displayedRecords.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + displayedRecords.length;
  const showLoadingMeta = loadingRecords && records.length === 0 && !filterActive;
  const metaText = filterActive
    ? filterMetaText(
        optimisticFilter ? null : totalMatches,
        displayedRecords.length,
        totalRecords,
        object.plural_name
      )
    : `${formatNumber(pageStart)}-${formatNumber(pageEnd)} of ${formatNumber(totalRecords)}`;

  if (isDealsView) {
    return (
      <DealsPipelineView
        object={object}
        records={displayedRecords}
        totalRecords={totalRecords}
        loading={loadingRecords}
        viewMode={viewMode}
        onViewModeChange={setDealsViewMode}
        filterQuery={filterQuery}
        filterInputRef={filterInputRef}
        onFilterQueryChange={setFilterQuery}
        totalMatches={optimisticFilter ? null : totalMatches}
        focusedRecordId={focusedRecordId}
        focusRequestVersion={focusRequestVersion}
        tableFocusRequest={focusRequest}
        onFocusedRecordChange={setFocusedRecordId}
        onRecordClick={onRowClick}
        onRecordsChanged={() => loadCurrentRecords({ quiet: true })}
        setError={setError}
      />
    );
  }

  return (
    <div className="table">
      <div className="table-toolbar">
        <div className="table-toolbar__meta">
          {showLoadingMeta ? (
            <>
              <Loader2 size={13} className="lucide spin" />
              <span>Loading {object.plural_name.toLowerCase()}</span>
            </>
          ) : (
            <>
              {loadingRecords && <Loader2 size={13} className="lucide spin" />}
              <span>{metaText}</span>
            </>
          )}
        </div>
        <TableFilterControl
          objectName={object.plural_name}
          value={filterQuery}
          inputRef={filterInputRef}
          onChange={setFilterQuery}
        />
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
        records={displayedRecords}
        valueColumns={valueColumns}
        failureBySignal={failureBySignal}
        runningBySignal={runningBySignal}
        retryingSignals={retryingSignals}
        onRetrySignal={retrySignal}
        onRowClick={onRowClick}
        focusedRecordId={focusedRecordId}
        focusRequestVersion={focusRequestVersion}
        tableFocusRequest={focusRequest}
        onFocusedRecordChange={setFocusedRecordId}
        loading={loadingRecords && records.length === 0 && !filterActive}
        emptyMessage={filterActive ? "no matching records" : undefined}
      />
    </div>
  );
}

function CloudSyncStatusPill({ status }: { status: CloudSyncStatus }) {
  const text = cloudSyncStatusPillText(status);
  if (!text) return null;
  const active = cloudSyncStatusPillActive(status);
  const isError = status.state === "error";
  const providers = status.state === "syncing" ? status.providers ?? [] : [];
  const linkedInOnly = providers.includes("linkedin") && !providers.includes("gmail");
  return (
    <div
      className={`cloud-sync-pill${active ? " cloud-sync-pill--active" : ""}${isError ? " cloud-sync-pill--error" : ""}`}
      role={isError ? "alert" : "status"}
      aria-live="polite"
      title={cloudSyncStatusPillTitle(status)}
    >
      {isError ? (
        <CircleAlert size={12} className="lucide" />
      ) : linkedInOnly ? (
        <LinkedInIcon size={12} className="lucide" />
      ) : providers.includes("gmail") ? (
        <Mail size={12} className="lucide" />
      ) : (
        <Loader2 size={12} className="lucide spin" />
      )}
      <span className="cloud-sync-pill__text">{text}</span>
    </div>
  );
}

function cloudSyncStatusPillText(status: CloudSyncStatus): string | null {
  if (status.state === "error") return status.message || "Cloud sync failed";
  if (status.state !== "syncing") return null;
  const providers = status.providers ?? [];
  const hasGmail = providers.includes("gmail");
  const hasLinkedIn = providers.includes("linkedin");
  if (hasGmail && hasLinkedIn) return "Syncing Gmail and LinkedIn";
  const progress = status.progress;
  if (hasLinkedIn) {
    if (progress?.writtenMessages != null && progress.writtenMessages > 0) {
      return `LinkedIn syncing · ${formatNumber(progress.writtenMessages)} messages`;
    }
    if (progress?.writtenThreads != null && progress.writtenThreads > 0) {
      return `LinkedIn syncing · ${formatNumber(progress.writtenThreads)} threads`;
    }
    return "LinkedIn syncing";
  }
  if (!hasGmail) return null;
  if (progress?.backfillStatus === "paused" || isFutureIso(progress?.resumeAfter)) {
    return "Gmail paused";
  }
  if (progress?.writtenThreads != null && progress.writtenThreads > 0) {
    return `Gmail syncing · ${formatNumber(progress.writtenThreads)} threads`;
  }
  if (progress?.fetchedThreads != null && progress.fetchedThreads > 0) {
    return `Gmail syncing · ${formatNumber(progress.fetchedThreads)} scanned`;
  }
  if (progress?.listedThreads != null && progress.listedThreads > 0) {
    return `Gmail syncing · ${formatNumber(progress.listedThreads)} listed`;
  }
  return "Gmail syncing";
}

function cloudSyncStatusPillActive(status: CloudSyncStatus): boolean {
  if (status.state !== "syncing") return false;
  if (status.providers?.includes("linkedin") && !status.providers?.includes("gmail")) return true;
  if (!status.providers?.includes("gmail")) return false;
  return status.progress?.backfillStatus !== "paused" && !isFutureIso(status.progress?.resumeAfter);
}

function cloudSyncStatusPillTitle(status: CloudSyncStatus): string {
  if (status.state === "error") return status.message || "Cloud sync failed";
  if (status.state !== "syncing") return "";
  const providers = status.providers ?? [];
  const providerName = providers.includes("linkedin") && !providers.includes("gmail")
    ? "LinkedIn"
    : providers.includes("gmail") && providers.includes("linkedin")
      ? "Gmail and LinkedIn"
      : "Gmail";
  const progress = status.progress;
  const parts = [
    progress?.listedThreads != null ? `${formatNumber(progress.listedThreads)} listed` : undefined,
    progress?.fetchedThreads != null ? `${formatNumber(progress.fetchedThreads)} fetched` : undefined,
    progress?.filteredThreads != null ? `${formatNumber(progress.filteredThreads)} filtered` : undefined,
    progress?.writtenThreads != null ? `${formatNumber(progress.writtenThreads)} threads written` : undefined,
    progress?.writtenMessages != null ? `${formatNumber(progress.writtenMessages)} messages written` : undefined
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `${providerName} sync in progress: ${parts.join(", ")}` : `${providerName} sync in progress`;
}

function isFutureIso(value: string | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

type RecordsEmptyConfig = {
  marks: string[];
  cols: [string, string, string];
  markShape: "square" | "circle";
  title: string;
  body: string;
};

const ACRM_ONBOARDING_PROMPT = "Onboard me into Agent CRM for this workspace";

const RECORDS_EMPTY_STATES: Record<string, RecordsEmptyConfig> = {
  companies: {
    marks: ["a", "r", "v"],
    cols: ["company", "domain", "linkedin"],
    markShape: "square",
    title: "Companies",
    body: "The accounts in your world — design partners, customers, prospects."
  },
  people: {
    marks: ["a", "b", "c"],
    cols: ["name", "email", "company"],
    markShape: "circle",
    title: "People",
    body: "The humans behind the accounts — champions, decision makers, the person who replied last Tuesday."
  },
  deals: {
    marks: ["$", "$", "$"],
    cols: ["deal", "stage", "value"],
    markShape: "square",
    title: "Deals",
    body: "The pipeline you're working — eval, trial, expansion, anything you call a stage."
  }
};

function RecordsEmptyState({
  slug
}: {
  slug: string;
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
        <OnboardingPromptSteps command={ACRM_ONBOARDING_PROMPT} />
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

function OnboardingPromptSteps({ command }: { command: string }) {
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
    <div className="onboarding-steps" aria-label="Onboarding steps">
      <div className="onboarding-step onboarding-step--primary">
        <span className="onboarding-step__number">1</span>
        <div className="onboarding-step__content">
          <span className="onboarding-step__title">Copy the onboarding prompt</span>
          <div className="onboarding-step__command-row">
            <code className="onboarding-step__command">
              <span aria-hidden="true">&gt;</span>
              <span>{command}</span>
            </code>
            <button type="button" className="onboarding-step__copy" onClick={onCopy}>
              <Copy size={13} className="lucide" />
              <span>{copied ? "Copied" : "Copy prompt"}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="onboarding-step">
        <span className="onboarding-step__number">2</span>
        <span className="onboarding-step__text">Paste this into the terminal</span>
      </div>
      <div className="onboarding-step">
        <span className="onboarding-step__number">3</span>
        <span className="onboarding-step__text">Watch this page fill in</span>
      </div>
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
  ],
  deals: [
    ["stage", "Stage"],
    ["value", "Value"],
    ["close_date", "Close date"]
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

function requestedRecordAttributes(
  object: SchemaObject,
  signals: SignalDefinitionSummary[],
) {
  const attrs = new Set(pickValueColumns(object, [], signals).map((column) => column.slug));
  if (object.object_slug === "people") {
    attrs.add("job_title");
    attrs.add("profile_picture_url");
  }
  if (object.object_slug === "deals") {
    for (const attr of [
      "stage",
      "value",
      "close_date",
      "next_step",
      "company",
      "account",
      "owner",
      "assignee",
      "source",
      "tags",
      "domain",
      "domains",
      "website",
      "last_touch",
      "last_message_at",
      "updated_at"
    ]) {
      attrs.add(attr);
    }
  }
  return [...attrs];
}

function DealsViewToggle({
  value,
  onChange
}: {
  value: DealsViewMode;
  onChange: (mode: DealsViewMode) => void;
}) {
  return (
    <SegmentedControl
      label="Deals view"
      value={value}
      onChange={onChange}
      options={[
        { value: "kanban", label: "Kanban", icon: <Columns3 size={12} className="lucide" /> },
        { value: "table", label: "Table", icon: <Table2 size={12} className="lucide" /> }
      ]}
    />
  );
}

function TableFilterControl({
  objectName,
  value,
  inputRef,
  onChange
}: {
  objectName: string;
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  const label = `Filter ${objectName.toLowerCase()}`;
  return (
    <label className="table-filter" data-active={value.trim() ? "true" : undefined}>
      <Search size={13} className="lucide" aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        autoCapitalize="none"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (value) {
            onChange("");
          } else {
            event.currentTarget.blur();
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="table-filter__clear"
          title="Clear filter"
          aria-label="Clear filter"
          onClick={() => {
            onChange("");
            window.requestAnimationFrame(() => filterInputRefFocus(inputRef));
          }}
        >
          <X size={12} className="lucide" />
        </button>
      ) : null}
    </label>
  );
}

function filterInputRefFocus(inputRef: RefObject<HTMLInputElement | null>) {
  inputRef.current?.focus();
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
              <IdentityMark object={object} record={record} />
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
  focusedRecordId,
  focusRequestVersion,
  tableFocusRequest,
  onFocusedRecordChange,
  loading,
  emptyMessage = "no records yet · run an import or create one"
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: ValueColumn[];
  failureBySignal: Map<string, SignalRunFailureSummary>;
  runningBySignal: Set<string>;
  retryingSignals: Set<string>;
  onRetrySignal?: (failure: SignalRunFailureSummary) => void;
  onRowClick?: (record: RecordPreview) => void;
  focusedRecordId?: string | null;
  focusRequestVersion?: number;
  tableFocusRequest?: number;
  onFocusedRecordChange?: (recordId: string) => void;
  loading: boolean;
  emptyMessage?: string;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [openSignalCell, setOpenSignalCell] = useState<string | null>(null);
  const [signalPopoverTabs, setSignalPopoverTabs] = useState<Record<string, SignalPopoverTab>>({});
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const handledTableFocusRequestRef = useRef(0);
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

  useEffect(() => {
    if (!focusedRecordId || !focusRequestVersion) return;
    const row = rowRefs.current.get(focusedRecordId);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedRecordId, focusRequestVersion]);

  useEffect(() => {
    if (!tableFocusRequest) return;
    if (handledTableFocusRequestRef.current === tableFocusRequest) return;
    const rowId = focusedRecordId ?? table.getRowModel().rows[0]?.id;
    if (!rowId) return;
    const row = rowRefs.current.get(rowId);
    handledTableFocusRequestRef.current = tableFocusRequest;
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedRecordId, table, tableFocusRequest]);

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
            <span>{emptyMessage}</span>
          </div>
        ) : null}
        {records.length > 0
          ? table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className="table__row"
              ref={(element) => {
                if (element) rowRefs.current.set(row.id, element);
                else rowRefs.current.delete(row.id);
              }}
              tabIndex={0}
              data-focused={focusedRecordId === row.id ? "true" : undefined}
              aria-selected={focusedRecordId === row.id}
              onFocus={() => onFocusedRecordChange?.(row.id)}
              onMouseDown={(event) => {
                onFocusedRecordChange?.(row.id);
                if (
                  event.target instanceof Element &&
                  event.target.closest("button, a, input, textarea, select, [contenteditable='true']")
                ) {
                  return;
                }
                event.currentTarget.focus({ preventScroll: true });
              }}
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

type DealStageColumn = {
  key: string;
  title: string;
  records: DealRecord[];
  valueTotal: number | null;
};

type DealRecord = {
  record: RecordPreview;
  id: string;
  title: string;
  company: string;
  domain: string;
  stage: string;
  stageKey: string;
  stageKind: "success" | "warning" | "danger" | "accent" | "neutral";
  value: RecordValue | undefined;
  valueAmount: number | null;
  valueLabel: string;
  closeDate: string;
  nextStep: string;
  owner: string;
  source: string;
  tags: string[];
  lastTouch: string;
};

function DealsPipelineView({
  object,
  records,
  totalRecords,
  loading,
  viewMode,
  onViewModeChange,
  filterQuery,
  filterInputRef,
  onFilterQueryChange,
  totalMatches,
  focusedRecordId,
  focusRequestVersion,
  tableFocusRequest,
  onFocusedRecordChange,
  onRecordClick,
  onRecordsChanged,
  setError
}: {
  object: SchemaObject;
  records: RecordPreview[];
  totalRecords: number;
  loading: boolean;
  viewMode: DealsViewMode;
  onViewModeChange: (mode: DealsViewMode) => void;
  filterQuery: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  onFilterQueryChange: (query: string) => void;
  totalMatches: number | null;
  focusedRecordId?: string | null;
  focusRequestVersion?: number;
  tableFocusRequest?: number;
  onFocusedRecordChange?: (recordId: string) => void;
  onRecordClick?: (record: RecordPreview) => void;
  onRecordsChanged?: () => Promise<void> | void;
  setError: (error: string | null) => void;
}) {
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});
  const [movingDealIds, setMovingDealIds] = useState<Set<string>>(() => new Set());
  const deals = useMemo(
    () => records.map((record) => toDealRecord(record, stageOverrides[dealRecordId(record)])),
    [records, stageOverrides],
  );
  const columns = useMemo(() => buildDealStageColumns(object, deals), [object, deals]);
  const visibleCount = deals.length;
  const filterActive = viewMode === "table" && normalizeTableFilterQuery(filterQuery).length > 0;
  const emptyMessage = filterActive ? "no matching deals" : "no deals yet - run an import or create one";
  const statusText = filterActive
    ? filterMetaText(totalMatches, visibleCount, totalRecords, object.plural_name)
    : `${formatNumber(visibleCount)} of ${formatNumber(totalRecords)} deals`;

  useEffect(() => {
    setStageOverrides((current) => {
      let changed = false;
      const next = { ...current };
      const recordsById = new Map(records.map((record) => [dealRecordId(record), record]));
      for (const [id, stage] of Object.entries(current)) {
        const record = recordsById.get(id);
        if (!record) {
          delete next[id];
          changed = true;
          continue;
        }
        const currentStage = recordValue(record, "stage")?.display.trim() || "Unstaged";
        if (stageKey(currentStage) === stageKey(stage)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [records]);

  const updateDealStage = useCallback(
    async (deal: DealRecord, targetStage: string) => {
      const nextStage = targetStage.trim();
      if (!nextStage || stageKey(nextStage) === "unstaged" || deal.stageKey === stageKey(nextStage)) {
        return;
      }
      setError(null);
      setStageOverrides((current) => ({ ...current, [deal.id]: nextStage }));
      setMovingDealIds((current) => {
        const next = new Set(current);
        next.add(deal.id);
        return next;
      });
      try {
        await api.updateRecord({
          object_slug: deal.record.object_slug,
          record_id: deal.record.record_id,
          fields: [`stage=${stageUpdateValue(object, nextStage)}`],
          source: "app:deals-kanban"
        });
        await onRecordsChanged?.();
      } catch (error) {
        setStageOverrides((current) => {
          const next = { ...current };
          delete next[deal.id];
          return next;
        });
        setError(statusFromError(error));
      } finally {
        setMovingDealIds((current) => {
          const next = new Set(current);
          next.delete(deal.id);
          return next;
        });
      }
    },
    [object, onRecordsChanged, setError],
  );

  return (
    <div className="deals-workspace" aria-busy={loading}>
      <div className="deals-toolbar">
        {viewMode === "table" && (
          <TableFilterControl
            objectName={object.plural_name}
            value={filterQuery}
            inputRef={filterInputRef}
            onChange={onFilterQueryChange}
          />
        )}
        <div className="deals-toolbar__spacer" />
        <DealsViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      <div className="deals-workspace__body">
        {loading && records.length === 0 ? (
          viewMode === "table" ? (
            <DealsTableView deals={[]} emptyMessage={filterActive ? emptyMessage : "loading deals"} />
          ) : (
            <DealsKanbanSkeleton />
          )
        ) : viewMode === "kanban" ? (
          <DealsKanbanView
            columns={columns}
            movingDealIds={movingDealIds}
            onCardClick={(deal) => onRecordClick?.(deal.record)}
            onStageChange={updateDealStage}
          />
        ) : (
          <DealsTableView
            deals={deals}
            emptyMessage={emptyMessage}
            focusedDealId={focusedRecordId}
            focusRequestVersion={focusRequestVersion}
            tableFocusRequest={tableFocusRequest}
            onFocusedDealChange={onFocusedRecordChange}
            onRowClick={(deal) => onRecordClick?.(deal.record)}
          />
        )}
      </div>

      <div className="deals-status-bar">
        {loading && records.length > 0 && <Loader2 size={12} className="lucide spin" />}
        <span>{statusText}</span>
      </div>
    </div>
  );
}

function DealsKanbanView({
  columns,
  movingDealIds,
  onCardClick,
  onStageChange
}: {
  columns: DealStageColumn[];
  movingDealIds: Set<string>;
  onCardClick?: (deal: DealRecord) => void;
  onStageChange?: (deal: DealRecord, stage: string) => void;
}) {
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null);
  const [dropTargetStageKey, setDropTargetStageKey] = useState<string | null>(null);
  const dealsById = useMemo(() => {
    const next = new Map<string, DealRecord>();
    for (const column of columns) {
      for (const deal of column.records) next.set(deal.id, deal);
    }
    return next;
  }, [columns]);

  function handleDragStart(event: ReactDragEvent<HTMLButtonElement>, deal: DealRecord) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-agent-crm-deal", deal.id);
    event.dataTransfer.setData("text/plain", deal.id);
    setDraggingDealId(deal.id);
  }

  function handleDragEnd() {
    setDraggingDealId(null);
    setDropTargetStageKey(null);
  }

  function draggedDeal(event: ReactDragEvent<HTMLElement>): DealRecord | undefined {
    const id =
      event.dataTransfer.getData("application/x-agent-crm-deal") ||
      event.dataTransfer.getData("text/plain") ||
      draggingDealId;
    return id ? dealsById.get(id) : undefined;
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>, column: DealStageColumn) {
    if (!draggingDealId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetStageKey(column.key);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>, column: DealStageColumn) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropTargetStageKey((current) => (current === column.key ? null : current));
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>, column: DealStageColumn) {
    event.preventDefault();
    const deal = draggedDeal(event);
    setDraggingDealId(null);
    setDropTargetStageKey(null);
    if (!deal || movingDealIds.has(deal.id) || deal.stageKey === column.key) return;
    onStageChange?.(deal, column.title);
  }

  return (
    <div
      className="deals-kanban"
      aria-label="Deals by stage"
      style={{
        gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, ${
          columns.length <= 4 ? "minmax(210px, 1fr)" : "minmax(248px, 1fr)"
        })`
      }}
    >
      {columns.map((column) => (
        <section
          className="deal-stage-column"
          key={column.key}
          data-drop-target={dropTargetStageKey === column.key ? "true" : undefined}
          style={{ ["--stage-tone" as string]: stageToneColor(column.title) }}
          onDragEnter={(event) => handleDragOver(event, column)}
          onDragOver={(event) => handleDragOver(event, column)}
          onDragLeave={(event) => handleDragLeave(event, column)}
          onDrop={(event) => handleDrop(event, column)}
        >
          <header className="deal-stage-column__header">
            <span className="deal-stage-column__dot" />
            <span className="deal-stage-column__name">{column.title}</span>
            <span className="deal-stage-column__count">{formatNumber(column.records.length)}</span>
            <span className="deal-stage-column__value">
              {column.valueTotal === null ? "--" : formatCompactCurrency(column.valueTotal)}
            </span>
          </header>
          <div className="deal-stage-column__body">
            {column.records.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                dragging={draggingDealId === deal.id}
                moving={movingDealIds.has(deal.id)}
                onClick={() => onCardClick?.(deal)}
                onDragStart={(event) => handleDragStart(event, deal)}
                onDragEnd={handleDragEnd}
              />
            ))}
            {column.records.length === 0 && (
              <div className="deal-stage-column__drop">
                {dropTargetStageKey === column.key ? "release to move" : "no deals"}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function DealCard({
  deal,
  dragging = false,
  moving = false,
  onClick,
  onDragStart,
  onDragEnd
}: {
  deal: DealRecord;
  dragging?: boolean;
  moving?: boolean;
  onClick?: () => void;
  onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      type="button"
      className="deal-card"
      draggable={!moving}
      data-dragging={dragging ? "true" : undefined}
      data-moving={moving ? "true" : undefined}
      aria-busy={moving || undefined}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className="deal-card__head">
        <CompanyMark name={deal.company} size={18} />
        <span className="deal-card__company">{deal.company}</span>
        {deal.domain && <span className="deal-card__domain">{deal.domain}</span>}
      </span>
      <span className="deal-card__title display">{deal.title}</span>
      {deal.tags.length > 0 && (
        <span className="deal-card__tags">
          {deal.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} kind={dealTagKind(tag)}>
              {tag}
            </Badge>
          ))}
        </span>
      )}
      <span className="deal-card__foot">
        <span className="deal-card__value">{deal.valueLabel}</span>
        <span className="deal-card__foot-spacer" />
        {deal.owner && <Avatar name={deal.owner} size={16} />}
        {deal.lastTouch && <span className="deal-card__last">{deal.lastTouch}</span>}
      </span>
      {(deal.nextStep || deal.closeDate || deal.source) && (
        <span className="deal-card__subline">
          {deal.nextStep || deal.source || deal.closeDate}
        </span>
      )}
    </button>
  );
}

function DealsTableView({
  deals,
  emptyMessage = "no deals yet - run an import or create one",
  focusedDealId,
  focusRequestVersion,
  tableFocusRequest,
  onFocusedDealChange,
  onRowClick
}: {
  deals: DealRecord[];
  emptyMessage?: string;
  focusedDealId?: string | null;
  focusRequestVersion?: number;
  tableFocusRequest?: number;
  onFocusedDealChange?: (dealId: string) => void;
  onRowClick?: (deal: DealRecord) => void;
}) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const handledTableFocusRequestRef = useRef(0);

  useEffect(() => {
    if (!focusedDealId || !focusRequestVersion) return;
    const row = rowRefs.current.get(focusedDealId);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedDealId, focusRequestVersion]);

  useEffect(() => {
    if (!tableFocusRequest) return;
    if (handledTableFocusRequestRef.current === tableFocusRequest) return;
    const dealId = focusedDealId ?? deals[0]?.id;
    if (!dealId) return;
    const row = rowRefs.current.get(dealId);
    handledTableFocusRequestRef.current = tableFocusRequest;
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [deals, focusedDealId, tableFocusRequest]);

  return (
    <div className="deals-table" style={{ ["--deals-table-columns" as string]: DEALS_TABLE_COLUMNS }}>
      <div className="deals-table__head">
        <span />
        <span>Deal</span>
        <span>Stage</span>
        <span className="deals-table__right">Value</span>
        <span>Company</span>
        <span>Close date</span>
        <span>Next step</span>
      </div>
      <div className="deals-table__body">
        {deals.length === 0 ? (
          <div className="empty-inline">
            <span>{emptyMessage}</span>
          </div>
        ) : null}
        {deals.map((deal) => (
          <button
            key={deal.id}
            type="button"
            className="deals-table__row"
            ref={(element) => {
              if (element) rowRefs.current.set(deal.id, element);
              else rowRefs.current.delete(deal.id);
            }}
            data-focused={focusedDealId === deal.id ? "true" : undefined}
            aria-selected={focusedDealId === deal.id}
            onFocus={() => onFocusedDealChange?.(deal.id)}
            onMouseDown={() => onFocusedDealChange?.(deal.id)}
            onClick={() => onRowClick?.(deal)}
          >
            <span className="cell-check" />
            <span className="deals-table__deal">
              <CompanyMark name={deal.company} size={22} />
              <span>
                <span>{deal.title}</span>
                <span>{[deal.domain, deal.source].filter(Boolean).join(" · ") || deal.company}</span>
              </span>
            </span>
            <span>
              <Badge kind={deal.stageKind} dot>{deal.stage}</Badge>
            </span>
            <span className="deals-table__value">{deal.valueLabel}</span>
            <span className="deals-table__muted">{deal.company}</span>
            <span className="deals-table__muted">{deal.closeDate || "--"}</span>
            <span className="deals-table__muted">{deal.nextStep || "--"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const DEALS_TABLE_COLUMNS = "28px minmax(260px, 2fr) minmax(116px, .8fr) minmax(92px, .6fr) minmax(140px, 1fr) minmax(112px, .75fr) minmax(180px, 1.2fr)";

function DealsKanbanSkeleton() {
  return (
    <div className="deals-kanban deals-kanban--skeleton">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <section className="deal-stage-column deal-stage-column--skeleton" key={columnIndex}>
          <header className="deal-stage-column__header">
            <span className="kanban-skeleton kanban-skeleton--dot" />
            <span className="kanban-skeleton kanban-skeleton--badge" />
            <span className="kanban-skeleton kanban-skeleton--count" />
          </header>
          <div className="deal-stage-column__body">
            {Array.from({ length: 3 }).map((__, cardIndex) => (
              <span className="deal-card deal-card--skeleton" key={cardIndex}>
                <span className="kanban-skeleton kanban-skeleton--title" />
                <span className="kanban-skeleton kanban-skeleton--meta" />
                <span className="kanban-skeleton kanban-skeleton--line" />
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function toDealRecord(record: RecordPreview, stageOverride?: string): DealRecord {
  const stage = (stageOverride ?? recordValue(record, "stage")?.display.trim()) || "Unstaged";
  const companyValue = recordValue(record, "company", "account");
  const domainValue = recordValue(record, "domain", "domains", "website");
  const value = recordValue(record, "value", "amount", "deal_value");
  const owner = recordValue(record, "owner", "assignee")?.display.trim() ?? "";
  const closeDate = formatDealDate(recordValue(record, "close_date", "expected_close_date")) ?? "";
  const lastTouch =
    formatDealDate(recordValue(record, "last_touch", "last_message_at", "updated_at")) ??
    "";
  const source = recordValue(record, "source")?.display.trim() ?? "";
  const tags = dealTags(recordValue(record, "tags", "tag"));
  const valueAmount = numericDealValue(value);
  const company = companyValue?.display.trim() || dealCompanyFromSubtitle(record, stage, value, valueAmount);

  return {
    record,
    id: `${record.object_slug}:${record.record_id}`,
    title: record.label,
    company,
    domain: domainValue?.display.trim() ?? "",
    stage,
    stageKey: stageKey(stage),
    stageKind: stageKind(stage),
    value,
    valueAmount,
    valueLabel: formatDealValue(value) ?? "--",
    closeDate,
    nextStep: recordValue(record, "next_step", "next_steps")?.display.trim() ?? "",
    owner,
    source,
    tags,
    lastTouch
  };
}

function dealRecordId(record: RecordPreview): string {
  return `${record.object_slug}:${record.record_id}`;
}

function stageUpdateValue(object: SchemaObject, stage: string): string {
  const stageAttribute = object.attributes.find((attribute) => attribute.attribute_slug === "stage");
  const option = stageOptionsFromConfig(stageAttribute?.config).find(
    (candidate) => stageKey(candidate.title) === stageKey(stage) || stageKey(candidate.id) === stageKey(stage),
  );
  return option?.id || stage;
}

function stageOptionsFromConfig(config: unknown): Array<{ id: string; title: string }> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const object = config as Record<string, unknown>;
  const candidates = [object.options, object.statuses, object.choices, object.values];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.flatMap((option) => {
      if (typeof option === "string") return [{ id: option, title: option }];
      if (!option || typeof option !== "object" || Array.isArray(option)) return [];
      const item = option as Record<string, unknown>;
      const id = item.id ?? item.value ?? item.name ?? item.label ?? item.title;
      const title = item.title ?? item.label ?? item.name ?? item.value ?? item.id;
      if (typeof id !== "string" || typeof title !== "string") return [];
      return [{ id, title }];
    });
  }
  return [];
}

function dealCompanyFromSubtitle(
  record: RecordPreview,
  stage: string,
  value: RecordValue | undefined,
  valueAmount: number | null
): string {
  const ignored = new Set(
    [
      stage,
      value?.display,
      valueAmount === null ? null : String(valueAmount),
      valueAmount === null ? null : formatDealValue(value),
    ]
      .filter((item): item is string => Boolean(item))
      .map(stageKey),
  );
  const company = record.subtitle
    .split("·")
    .map((part) => part.trim())
    .find((part) => {
      if (!part || ignored.has(stageKey(part))) return false;
      return !/^\$?\d[\d,]*(?:\.\d+)?[kKmM]?$/.test(part);
    });
  return company || "Unknown account";
}

function buildDealStageColumns(object: SchemaObject, deals: DealRecord[]): DealStageColumn[] {
  const configuredStages = stageOptionLabels(object);
  const optionOrder = new Map(configuredStages.map((stage, index) => [stageKey(stage), index]));
  const byStage = new Map<string, DealStageColumn>();

  function ensureColumn(title: string): DealStageColumn {
    const key = stageKey(title);
    const existing = byStage.get(key);
    if (existing) return existing;
    const column = {
      key,
      title: title.trim() || "Unstaged",
      records: [],
      valueTotal: null
    };
    byStage.set(key, column);
    return column;
  }

  for (const stage of configuredStages) {
    ensureColumn(stage);
  }

  for (const deal of deals) {
    ensureColumn(deal.stage).records.push(deal);
  }

  const columns = [...byStage.values()].map((column) => ({
    ...column,
    valueTotal: sumDealValues(column.records)
  }));

  return columns.sort((left, right) => compareDealStages(left.title, right.title, optionOrder));
}

function compareDealStages(
  left: string,
  right: string,
  optionOrder: Map<string, number>
): number {
  const leftOption = optionOrder.get(stageKey(left));
  const rightOption = optionOrder.get(stageKey(right));
  if (leftOption !== undefined && rightOption !== undefined) return leftOption - rightOption;
  if (leftOption !== undefined) return -1;
  if (rightOption !== undefined) return 1;

  const leftRank = stageRank(left);
  const rightRank = stageRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.localeCompare(right);
}

function stageOptionLabels(object: SchemaObject): string[] {
  const stageAttribute = object.attributes.find((attribute) => attribute.attribute_slug === "stage");
  return optionLabelsFromConfig(stageAttribute?.config);
}

function optionLabelsFromConfig(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const object = config as Record<string, unknown>;
  const candidates = [object.options, object.statuses, object.choices, object.values];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return uniqueNonEmpty(candidate.map(optionLabel).filter((label): label is string => Boolean(label)));
  }
  return [];
}

function optionLabel(option: unknown): string | null {
  if (typeof option === "string") return option;
  if (!option || typeof option !== "object" || Array.isArray(option)) return null;
  const object = option as Record<string, unknown>;
  const value = object.title ?? object.label ?? object.name ?? object.value ?? object.id;
  return typeof value === "string" ? value : null;
}

function stageKey(stage: string) {
  return stage.trim().toLowerCase().replace(/\s+/g, " ") || "unstaged";
}

function stageRank(stage: string): number {
  const value = stageKey(stage);
  const order = [
    ["new", "lead", "prospect"],
    ["discovery"],
    ["qualified"],
    ["eval", "evaluation", "in progress"],
    ["trial", "pilot", "poc"],
    ["proposal"],
    ["negotiation", "procurement"],
    ["contract", "legal"],
    ["won", "closed won", "gone", "live", "active"],
    ["lost", "closed lost", "churn"]
  ];
  if (value === "unstaged") return order.length + 1;
  const found = order.findIndex((group) => group.some((hint) => value.includes(hint)));
  return found === -1 ? order.length : found;
}

function recordValue(record: RecordPreview, ...attributeSlugs: string[]): RecordValue | undefined {
  for (const attributeSlug of attributeSlugs) {
    const value = record.values.find(
      (candidate) => candidate.attribute_slug === attributeSlug && candidate.display,
    );
    if (value) return value;
  }
  return undefined;
}

function sumDealValues(deals: DealRecord[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const deal of deals) {
    if (deal.valueAmount === null) continue;
    total += deal.valueAmount;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function numericDealValue(value?: RecordValue): number | null {
  if (!value) return null;
  const candidates = rawNumberCandidates(value.raw);
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate !== "string") continue;
    const parsed = Number.parseFloat(candidate.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function rawNumberCandidates(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [raw];
  const object = raw as Record<string, unknown>;
  return [object.amount, object.value, object.currency_value, object.total, object.number];
}

function formatDealValue(value?: RecordValue): string | null {
  if (!value?.display) return null;
  const amount = numericDealValue(value);
  if (amount === null) return value.display;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: dealCurrency(value) ?? "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

function dealCurrency(value: RecordValue): string | null {
  if (!value.raw || typeof value.raw !== "object" || Array.isArray(value.raw)) return null;
  const raw = value.raw as Record<string, unknown>;
  const currency = raw.currency ?? raw.currency_code ?? raw.currencyCode;
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function formatDealDate(value?: RecordValue): string | null {
  if (!value?.display) return null;
  const raw = typeof value.raw === "object" && value.raw !== null && !Array.isArray(value.raw)
    ? (value.raw as Record<string, unknown>).date ??
      (value.raw as Record<string, unknown>).timestamp ??
      (value.raw as Record<string, unknown>).value
    : value.raw;
  const candidate = typeof raw === "string" ? raw : value.display;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return formatDateOnly(candidate);
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? value.display : formatDateDisplay(new Date(parsed).toISOString());
}

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1).replace(/\.?0+$/, "")}k`;
  return `$${formatNumber(value)}`;
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function dealTags(value?: RecordValue): string[] {
  if (!value) return [];
  return uniqueNonEmpty(
    value.values
      .flatMap((item) => {
        if (Array.isArray(item)) return item.map(displayUnknown);
        if (typeof item === "object" && item !== null) {
          return [displayUnknown(item)];
        }
        return [displayUnknown(item)];
      })
      .flatMap((item) => item.split(","))
  );
}

function dealTagKind(tag: string): "success" | "warning" | "danger" | "accent" | "neutral" {
  const value = tag.toLowerCase();
  if (["champion", "design partner", "yc", "expansion"].some((hint) => value.includes(hint))) return "accent";
  if (["churn", "lost", "dark"].some((hint) => value.includes(hint))) return "danger";
  return "neutral";
}

function stageToneColor(stage: string): string {
  const kind = stageKind(stage);
  if (kind === "success") return "var(--success)";
  if (kind === "warning") return "var(--warning)";
  if (kind === "danger") return "var(--danger)";
  if (kind === "accent") return "var(--accent)";
  return "var(--text-dim)";
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

function normalizeTableFilterQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function tableFilterTerms(query: string): string[] {
  const normalized = normalizeTableFilterQuery(query);
  return normalized ? normalized.split(" ").slice(0, 8) : [];
}

function filterRecordsForQuery(records: RecordPreview[], query: string): RecordPreview[] {
  const terms = tableFilterTerms(query);
  if (terms.length === 0) return records;
  return records.filter((record) => {
    const haystack = recordSearchText(record);
    return terms.every((term) => haystack.includes(term));
  });
}

function recordSearchText(record: RecordPreview): string {
  return [
    record.label,
    record.subtitle,
    ...record.values.flatMap((value) => [
      value.title,
      value.display,
      ...value.values.map(displayUnknown)
    ])
  ]
    .join(" ")
    .toLowerCase();
}

function filterMetaText(
  totalMatches: number | null,
  visibleCount: number,
  totalRecords: number,
  objectName: string
): string {
  if (totalMatches !== null) {
    return `${formatNumber(totalMatches)} ${totalMatches === 1 ? "match" : "matches"} in ${formatNumber(totalRecords)} ${objectName.toLowerCase()}`;
  }
  return `${formatNumber(visibleCount)} ${visibleCount === 1 ? "match" : "matches"}`;
}

function TableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 10 }).map((_, rowIndex) => (
        <div key={rowIndex} className="table__row table__row--skeleton">
          {Array.from({ length: columnCount }).map((__, columnIndex) => (
            <span key={columnIndex} className="table__cell table__cell--skeleton">
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

function IdentityMark({ object, record }: { object: SchemaObject; record: RecordPreview }) {
  if (object.object_slug === "people") {
    return <Avatar name={record.label} size={20} src={recordImageUrl(record, "profile_picture_url")} />;
  }
  if (object.object_slug === "companies") return <CompanyMark name={record.label} size={20} />;
  return <CompanyMark name={`${object.singular_name} ${record.label}`} size={20} />;
}

function recordImageUrl(record: RecordPreview, attributeSlug: string): string | undefined {
  const value = record.values.find((item) => item.attribute_slug === attributeSlug);
  const display = value?.display.trim();
  if (display) return display;
  for (const raw of value?.values ?? []) {
    const text = scalarText(raw).trim();
    if (text) return text;
  }
  return undefined;
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
  if (value.attribute_slug === "linkedin_url") {
    return (
      <a className="table__cell--mono table__cell-link" href={externalUrl(value.display)} target="_blank" rel="noreferrer">
        {value.display}
      </a>
    );
  }
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
  if (["live", "expansion", "won", "gone", "active"].some((s) => v.includes(s))) return "success";
  if (["in progress"].some((s) => v.includes(s))) return "accent";
  if (["lead", "prospect", "discovery", "qualified", "eval", "queued", "trial", "pilot"].some((s) => v.includes(s))) return "warning";
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
  record,
  focusRequest
}: {
  object: SchemaObject;
  record: RecordPreview;
  focusRequest: number;
}) {
  const meta = record.subtitle && record.subtitle !== object.singular_name ? record.subtitle : null;
  const detailRef = useRef<HTMLDivElement | null>(null);
  const handledFocusRequestRef = useRef(0);

  useEffect(() => {
    if (!focusRequest) return;
    if (handledFocusRequestRef.current === focusRequest) return;
    handledFocusRequestRef.current = focusRequest;
    detailRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  return (
    <div ref={detailRef} className="detail" tabIndex={-1}>
      <header className="detail__header">
        <h1 className="detail__title display">{record.label}</h1>
        {meta && <div className="detail__meta">{meta}</div>}
      </header>

      <RecordSignalsPanel object={object} record={record} />
    </div>
  );
}

function CompanyDetail({
  object,
  peopleObject,
  record,
  tab,
  focusRequest,
  onTabChange
}: {
  object: SchemaObject;
  peopleObject?: SchemaObject;
  record: RecordPreview;
  tab: CompanyTab;
  focusRequest: number;
  onTabChange: (tab: CompanyTab) => void;
}) {
  const meta = record.subtitle && record.subtitle !== object.singular_name ? record.subtitle : null;
  const teamObject = peopleObject ?? FALLBACK_PEOPLE_OBJECT;
  const teamColumns = useMemo(() => companyTeamValueColumns(teamObject), [teamObject]);
  const { signalValues, otherValues } = useRecordDetailValues(object, record);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const handledFocusRequestRef = useRef(0);
  const [team, setTeam] = useState<RecordPreview[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [focusedTeamRecordId, setFocusedTeamRecordId] = useState<string | null>(null);
  const emptySignalFailures = useMemo(() => new Map<string, SignalRunFailureSummary>(), []);
  const emptyRunningSignals = useMemo(() => new Set<string>(), []);
  const emptyRetryingSignals = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    let cancelled = false;
    setLoadingTeam(true);
    setTeamError(null);
    setTeam([]);
    setFocusedTeamRecordId(null);
    fetchCompanyTeam(record.record_id)
      .then((people) => {
        if (!cancelled) setTeam(people);
      })
      .catch((err) => {
        if (!cancelled) setTeamError(statusFromError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTeam(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.record_id]);

  useEffect(() => {
    if (!focusRequest) return;
    if (handledFocusRequestRef.current === focusRequest) return;
    handledFocusRequestRef.current = focusRequest;
    detailRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target) || isTerminalTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".sidebar")) return;

      const currentIndex = COMPANY_TABS.indexOf(tab);
      if (currentIndex === -1) return;
      const nextIndex =
        event.key === "ArrowRight"
          ? Math.min(COMPANY_TABS.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      const nextTab = COMPANY_TABS[nextIndex];
      if (nextTab === tab) return;

      event.preventDefault();
      onTabChange(nextTab);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTabChange, tab]);

  return (
    <div ref={detailRef} className="detail" tabIndex={-1}>
      <header className="detail__header detail__header--company">
        <div className="detail__photo detail__photo--company">
          <CompanyMark name={record.label} size={64} />
        </div>
        <div className="detail__identity">
          <h1 className="detail__title display">{record.label}</h1>
          {meta && <div className="detail__meta">{meta}</div>}
        </div>
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
          aria-current={tab === "team"}
          onClick={() => onTabChange("team")}
        >
          Team <span className="tab__count">{team.length}</span>
        </button>
        <button
          type="button"
          className="tab"
          aria-current={tab === "signals"}
          onClick={() => onTabChange("signals")}
        >
          Signals
        </button>
      </nav>

      <div className="company-detail__body">
        <section className="company-detail__main">
          {tab === "overview" ? (
            <RecordFieldsSection values={otherValues} />
          ) : tab === "team" ? (
            teamError ? (
              <div className="empty-inline"><span>{teamError}</span></div>
            ) : loadingTeam ? (
              <div className="empty-inline"><span>loading team…</span></div>
            ) : (
              <div className="company-detail__table table">
                <RecordsTable
                  object={teamObject}
                  records={team}
                  valueColumns={teamColumns}
                  failureBySignal={emptySignalFailures}
                  runningBySignal={emptyRunningSignals}
                  retryingSignals={emptyRetryingSignals}
                  focusedRecordId={focusedTeamRecordId}
                  onFocusedRecordChange={setFocusedTeamRecordId}
                  loading={false}
                  emptyMessage={`no people linked to ${record.label} yet`}
                />
              </div>
            )
          ) : (
            <RecordSignalsSection signalValues={signalValues} />
          )}
        </section>
      </div>
    </div>
  );
}

const FALLBACK_PEOPLE_OBJECT: SchemaObject = {
  object_slug: "people",
  singular_name: "Person",
  plural_name: "People",
  attributes: [
    {
      attribute_slug: "name",
      title: "Name",
      attribute_type: "personal-name",
      is_multivalued: false,
      is_unique: false
    },
    {
      attribute_slug: "job_title",
      title: "Title",
      attribute_type: "text",
      is_multivalued: false,
      is_unique: false
    },
    {
      attribute_slug: "email_addresses",
      title: "Email",
      attribute_type: "email-address",
      is_multivalued: true,
      is_unique: true
    },
    {
      attribute_slug: "linkedin_url",
      title: "LinkedIn",
      attribute_type: "url",
      is_multivalued: false,
      is_unique: true
    }
  ]
};

function companyTeamValueColumns(peopleObject: SchemaObject): ValueColumn[] {
  const titles = new Map(peopleObject.attributes.map((attribute) => [
    attribute.attribute_slug,
    attribute.title
  ]));
  return [
    { slug: "job_title", title: titles.get("job_title") ?? "Title", isSignal: false },
    { slug: "email_addresses", title: titles.get("email_addresses") ?? "Email", isSignal: false },
    { slug: "linkedin_url", title: titles.get("linkedin_url") ?? "LinkedIn", isSignal: false }
  ];
}

function RecordSignalsPanel({
  object,
  record
}: {
  object: SchemaObject;
  record: RecordPreview;
}) {
  const { signalValues, otherValues } = useRecordDetailValues(object, record);

  return (
    <div className="record-detail">
      <RecordSignalsSection signalValues={signalValues} />
      <RecordFieldsAside values={otherValues} />
    </div>
  );
}

function useRecordDetailValues(
  object: SchemaObject,
  record: RecordPreview
): {
  signalValues: RecordValue[];
  otherValues: RecordValue[];
} {
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

  return { signalValues, otherValues };
}

function RecordSignalsSection({ signalValues }: { signalValues: RecordValue[] }) {
  return (
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
  );
}

function RecordFieldsSection({ values }: { values: RecordValue[] }) {
  return (
    <section className="record-detail__section">
      <MonoLabel>Fields</MonoLabel>
      {values.length === 0 ? (
        <div className="empty-inline">
          <span>no other fields on file</span>
        </div>
      ) : (
        <div className="record-fields">
          {values.map((value) => (
            <RecordField key={value.attribute_slug} value={value} compact />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordFieldsAside({ values }: { values: RecordValue[] }) {
  return (
    <aside className="record-detail__aside">
      <MonoLabel>Fields</MonoLabel>
      {values.length === 0 ? (
        <div className="empty-inline">
          <span>no other fields on file</span>
        </div>
      ) : (
        <div className="record-fields">
          {values.map((value) => (
            <RecordField key={value.attribute_slug} value={value} compact />
          ))}
        </div>
      )}
    </aside>
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
const MAX_DROPPED_FILE_BYTES = 50 * 1024 * 1024;
const TERMINAL_PATH_ESCAPE_PATTERN = /([\s'"\\$`!*?()[\]{}|;<>&#~])/g;

function isHeicLikeFile(file: File): boolean {
  const type = file.type.toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/i.test(file.name);
}

function isUnstableDropPath(filePath: string): boolean {
  if (!filePath) return true;
  if (/^\/(?:private\/)?var\/folders\/.*\/T\/Drops\//.test(filePath)) return true;
  if (/[\\/](?:tmp|temp)[\\/]/i.test(filePath) && /(?:drop|chromium|electron)/i.test(filePath)) {
    return true;
  }
  if (/[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(filePath)) return true;
  return false;
}

function escapeTerminalPath(filePath: string): string {
  return filePath.replace(TERMINAL_PATH_ESCAPE_PATTERN, "\\$1");
}

function escapeWindowsTerminalPath(filePath: string): string {
  return `"${filePath.replace(/"/g, "\"\"")}"`;
}

function formatTerminalDroppedPaths(paths: string[]): string {
  if (window.crm?.platform === "win32") {
    return paths.map(escapeWindowsTerminalPath).join(" ");
  }
  return paths.map(escapeTerminalPath).join(" ");
}

function wrapAsBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

function hasDroppedFiles(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

async function resolveDroppedTerminalFile(file: File): Promise<string | null> {
  const bridge = window.terminal;
  if (!bridge) return null;

  const directPath = (file as File & { path?: unknown }).path;
  const originalPath =
    typeof directPath === "string" && directPath.trim().length > 0
      ? directPath.trim()
      : bridge.getPathForFile(file).trim();
  if (originalPath && !isUnstableDropPath(originalPath) && !isHeicLikeFile(file)) {
    return originalPath;
  }

  if (file.size > MAX_DROPPED_FILE_BYTES) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await bridge.persistDroppedFile({
      bytes,
      name: file.name,
      mimeType: file.type
    });
  } catch {
    return null;
  }
}

function agentCliPreflightLabel(status: AgentCliPreflightStatus): string | null {
  if (status.state === "checking") return "checking Agent CRM CLI";
  if (status.state === "updating") return "updating Agent CRM CLI";
  if (status.state === "error") return "Agent CRM CLI needs attention";
  return null;
}

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
  const [agentCliPreflightStatus, setAgentCliPreflightStatus] =
    useState<AgentCliPreflightStatus>({ state: "idle" });

  useEffect(() => {
    const bridge = window.terminal;
    if (!bridge) return;
    return bridge.onAgentCliPreflightStatus((status) => {
      setAgentCliPreflightStatus(status);
    });
  }, []);

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
            bridge.send(sessionId, "claude --dangerously-skip-permissions\n");
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

  const agentCliLabel = agentCliPreflightLabel(agentCliPreflightStatus);

  function onTerminalDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function onTerminalDrop(event: ReactDragEvent<HTMLElement>) {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const bridge = window.terminal;
    const term = termRef.current;
    if (!bridge || !term) return;

    const files = Array.from(event.dataTransfer.files);

    void (async () => {
      const resolved = await Promise.all(files.map((file) => resolveDroppedTerminalFile(file)));
      const paths = resolved.filter((filePath): filePath is string => Boolean(filePath));
      if (paths.length === 0) return;
      term.focus();
      bridge.send(sessionIdRef.current, `${wrapAsBracketedPaste(formatTerminalDroppedPaths(paths))} `);
    })();
  }

  return (
    <aside
      className="terminal"
      hidden={!visible}
      style={{ width }}
      onDragOverCapture={onTerminalDragOver}
      onDropCapture={onTerminalDrop}
    >
      <div
        className="terminal__resizer"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
      />
      <div className="terminal__head">
        <Terminal size={13} className="lucide" />
        <span className="mono-label">shell</span>
        {agentCliLabel && (
          <span
            className="terminal__status"
            data-state={agentCliPreflightStatus.state}
            title={
              agentCliPreflightStatus.state === "error"
                ? agentCliPreflightStatus.message
                : agentCliLabel
            }
          >
            {agentCliPreflightStatus.state === "error" ? (
              <CircleAlert size={12} className="lucide" />
            ) : (
              <Loader2 size={12} className="lucide spin" />
            )}
            <span>{agentCliLabel}</span>
          </span>
        )}
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

type EmailBodyTextSegment = {
  text: string;
  href?: string;
};

type EmailBodyRenderBlock =
  | { type: "paragraph"; text: string; segments?: EmailBodyTextSegment[] }
  | { type: "forwarded_header"; fields: Record<string, string> }
  | { type: "quote"; text: string; depth: number }
  | { type: "signature"; text: string }
  | { type: "disclaimer"; text: string };

type EmailBodyRender = {
  version: 1;
  blocks: EmailBodyRenderBlock[];
};

type EmailAttachmentMetadata = {
  filename?: string;
  mimeType?: string;
  size?: number;
};

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

async function fetchCompanyTeam(companyRecordId: string): Promise<RecordPreview[]> {
  const [companyTeamResult, peopleCompanyResult] = await Promise.all([
    api.runQuery(
      `SELECT v.ref_record_id AS record_id
         FROM acrm_value v
        WHERE v.object_slug = 'companies'
          AND v.record_id = $1
          AND v.attribute_slug = 'team'
          AND v.ref_object = 'people'
          AND v.active_until IS NULL`,
      [companyRecordId]
    ),
    api.runQuery(
      `SELECT v.record_id AS record_id
         FROM acrm_value v
        WHERE v.object_slug = 'people'
          AND v.attribute_slug = 'company'
          AND v.ref_object = 'companies'
          AND v.ref_record_id = $1
          AND v.active_until IS NULL`,
      [companyRecordId]
    )
  ]);

  const teamRecordIds = uniqueNonEmpty(
    [...companyTeamResult.rows, ...peopleCompanyResult.rows].map((row) =>
      row.record_id == null ? "" : String(row.record_id)
    )
  );
  if (teamRecordIds.length === 0) return [];

  const teamRecords = await Promise.all(teamRecordIds.map(fetchCompanyTeamPerson));
  return teamRecords
    .map(teamRelatedRecordToPreview)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchCompanyTeamPerson(personRecordId: string): Promise<RelatedRecord> {
  const result = await api.runQuery(
    `SELECT record_id AS rec_id, attribute_slug AS attr, value_json AS val
       FROM acrm_value
      WHERE object_slug = 'people'
        AND record_id = $1
        AND active_until IS NULL
        AND attribute_slug IN (
          'name',
          'email_addresses',
          'email',
          'job_title',
          'title',
          'linkedin_url',
          'profile_picture_url'
        )`,
    [personRecordId]
  );

  const entry: RelatedRecord = { id: personRecordId, attrs: {} };
  for (const row of result.rows) {
    if (row.attr != null) {
      pushAttrValue(entry.attrs, String(row.attr), parseValueJson(row.val));
    }
  }
  return entry;
}

function teamRelatedRecordToPreview(item: RelatedRecord): RecordPreview {
  const attrs = { ...item.attrs };
  if (attrs.email_addresses === undefined && attrs.email !== undefined) {
    attrs.email_addresses = attrs.email;
  }
  if (attrs.job_title === undefined && attrs.title !== undefined) {
    attrs.job_title = attrs.title;
  }
  const values = Object.entries(attrs)
    .map(([attributeSlug, value]) => relatedAttrToRecordValue(attributeSlug, value))
    .filter((value) => value.display);
  const label =
    getScalar(attrs, "name") ||
    getScalar(attrs, "email_addresses") ||
    stripUrl(getScalar(attrs, "linkedin_url")) ||
    item.id.slice(0, 8);
  const subtitle = [
    getScalar(attrs, "job_title"),
    getScalar(attrs, "email_addresses") || stripUrl(getScalar(attrs, "linkedin_url"))
  ].filter(Boolean).join(" · ");
  return {
    object_slug: "people",
    record_id: item.id,
    label,
    subtitle: subtitle || "Person",
    values
  };
}

function relatedAttrToRecordValue(attributeSlug: string, value: unknown): RecordValue {
  const values = Array.isArray(value) ? value : [value];
  return {
    attribute_slug: attributeSlug,
    title: relatedAttributeTitle(attributeSlug),
    type: relatedAttributeType(attributeSlug),
    display: values.map(displayUnknown).filter(Boolean).join(", "),
    raw: values.length === 1 ? values[0] : values,
    values
  };
}

function relatedAttributeTitle(attributeSlug: string): string {
  const titles: Record<string, string> = {
    email_addresses: "Email",
    email: "Email",
    job_title: "Title",
    linkedin_url: "LinkedIn",
    profile_picture_url: "Profile picture"
  };
  return titles[attributeSlug] ?? attributeSlug.replace(/_/g, " ");
}

function relatedAttributeType(attributeSlug: string): string {
  if (attributeSlug === "email_addresses" || attributeSlug === "email") return "email-address";
  if (attributeSlug.endsWith("_url")) return "url";
  return "text";
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

function getSingleAttrValue(attrs: Record<string, unknown>, key: string): unknown {
  const value = attrs[key];
  return Array.isArray(value) ? value[0] : value;
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
    if (!isPlainObject(item)) return [];
    const ref = item as Record<string, unknown>;
    return typeof ref.target_record_id === "string" ? [ref.target_record_id] : [];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function transcriptContent(item: RelatedRecord): string {
  return getScalar(item.attrs, "content").trim();
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
  focusRequest,
  onTabChange
}: {
  record: RecordPreview;
  tab: PersonTab;
  focusRequest: number;
  onTabChange: (tab: PersonTab) => void;
}) {
  const baseMeta = record.subtitle && record.subtitle !== "Person" ? record.subtitle : "";
  const profilePictureUrl = recordImageUrl(record, "profile_picture_url");
  const meta = baseMeta || null;
  const contactRows = buildContactRows(record);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const handledFocusRequestRef = useRef(0);

  const [communicationThreads, setCommunicationThreads] = useState<CommunicationThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messageChannel, setMessageChannel] = useState<CommunicationChannel | "all" | "unread">("all");
  const [transcripts, setTranscripts] = useState<RelatedRecord[]>([]);
  const [posts, setPosts] = useState<RelatedRecord[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [copiedTranscriptId, setCopiedTranscriptId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedThreadId(null);
  }, [record.record_id, tab]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRelated(true);
    setRelatedError(null);
    setCommunicationThreads([]);
    setCopiedTranscriptId(null);

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

  useEffect(() => {
    if (!focusRequest) return;
    if (handledFocusRequestRef.current === focusRequest) return;
    handledFocusRequestRef.current = focusRequest;
    detailRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target) || isTerminalTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".sidebar")) return;

      const currentIndex = PERSON_TABS.indexOf(tab);
      if (currentIndex === -1) return;
      const nextIndex =
        event.key === "ArrowRight"
          ? Math.min(PERSON_TABS.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      const nextTab = PERSON_TABS[nextIndex];
      if (nextTab === tab) return;

      event.preventDefault();
      onTabChange(nextTab);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTabChange, tab]);

  async function copyTranscript(item: RelatedRecord) {
    const content = transcriptContent(item);
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTranscriptId(item.id);
      window.setTimeout(() => {
        setCopiedTranscriptId((current) => current === item.id ? null : current);
      }, 1400);
    } catch (err) {
      setRelatedError(statusFromError(err));
    }
  }

  return (
    <div ref={detailRef} className="detail" tabIndex={-1}>
      <header
        className={profilePictureUrl ? "detail__header detail__header--person" : "detail__header"}
      >
        {profilePictureUrl ? (
          <div className="detail__photo">
            <Avatar name={record.label} size={88} src={profilePictureUrl} />
          </div>
        ) : null}
        <div className="detail__identity">
          <h1 className="detail__title display">{record.label}</h1>
          {meta && <div className="detail__meta">{meta}</div>}
        </div>
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
          <ContactSection rows={contactRows} />
          <section className="detail__activity">
            <MonoLabel>Recent activity</MonoLabel>
            <div className="empty-inline">
              <span>no activity yet · messages, agent runs, and transcripts will appear here</span>
            </div>
          </section>
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
              renderAction={(item) => {
                const content = transcriptContent(item);
                if (!content) return null;
                const copied = copiedTranscriptId === item.id;
                return (
                  <button
                    type="button"
                    className="icon-btn related-list__copy"
                    onClick={() => void copyTranscript(item)}
                    aria-label={copied ? "Transcript copied" : "Copy transcript"}
                    title={copied ? "Transcript copied" : "Copy transcript"}
                  >
                    {copied ? <Check size={13} className="lucide" /> : <Copy size={13} className="lucide" />}
                  </button>
                );
              }}
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
      {allThreads.length > 0 && (
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
      )}

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
    messagePreviewText(latest);
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
  const renderBody = emailBodyRenderFromAttrs(message.attrs);
  const attachments = emailAttachmentsFromAttrs(message.attrs);
  const fallbackBody = normalizeEmailBody(getScalar(message.attrs, "body_text") || getScalar(message.attrs, "snippet"));
  const fallbackParagraphs = fallbackBody ? fallbackBody.split(/\n{2,}/).filter((paragraph) => paragraph.trim()) : [];
  const mainBlocks = renderBody?.blocks.filter((block) => !isEmailDetailBlock(block)) ?? [];
  const detailBlocks = renderBody?.blocks.filter(isEmailDetailBlock) ?? [];
  const renderedBlocks = expanded ? renderBody?.blocks ?? [] : mainBlocks;
  const hasRenderBlocks = Boolean(renderBody?.blocks.length);
  const longBody = hasRenderBlocks
    ? mainBlocks.length > 5 || mainBlocks.some((block) => emailBlockText(block).length > 1200)
    : fallbackBody.length > 900 || fallbackParagraphs.length > 4;
  const expandable = longBody || detailBlocks.length > 0;
  const expandLabel = expanded
    ? longBody ? "Show less" : "Hide quoted details"
    : longBody ? "Show full message" : "Show quoted details";

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
        data-collapsed={longBody && !expanded ? "true" : undefined}
      >
        {hasRenderBlocks ? (
          renderedBlocks.map((block, index) => (
            <EmailBodyBlockView key={`${block.type}-${index}`} block={block} />
          ))
        ) : fallbackBody ? (
          fallbackParagraphs.map((paragraph, index) => (
            <p key={index}>{linkifyText(paragraph)}</p>
          ))
        ) : (
          <p className="thread-message__empty">No message body saved.</p>
        )}
      </div>
      {attachments.length > 0 && (
        <div className="thread-message__attachments">
          {attachments.map((attachment, index) => (
            <span key={`${attachment.filename ?? attachment.mimeType ?? "attachment"}-${index}`}>
              <Paperclip size={13} className="lucide" />
              <span>{attachmentLabel(attachment)}</span>
            </span>
          ))}
        </div>
      )}
      {expandable && (
        <button
          type="button"
          className="thread-message__expand"
          onClick={() => setExpanded((value) => !value)}
        >
          {expandLabel}
        </button>
      )}
    </article>
  );
}

function EmailBodyBlockView({ block }: { block: EmailBodyRenderBlock }) {
  if (block.type === "paragraph") {
    return <p>{renderEmailText(block)}</p>;
  }
  if (block.type === "forwarded_header") {
    const entries = forwardedHeaderEntries(block.fields);
    if (entries.length === 0) return null;
    return (
      <dl className="email-forwarded-header">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{linkifyText(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const paragraphs = block.text.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  return (
    <div
      className="email-detail-block"
      data-kind={block.type}
      data-depth={block.type === "quote" ? String(Math.min(Math.max(block.depth, 1), 4)) : undefined}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{linkifyText(paragraph)}</p>
      ))}
    </div>
  );
}

function messagePreviewText(message: CommunicationMessage | undefined): string {
  if (!message) return "";
  return (
    getScalar(message.attrs, "body_preview") ||
    getScalar(message.attrs, "snippet") ||
    emailRenderPreview(emailBodyRenderFromAttrs(message.attrs)) ||
    getScalar(message.attrs, "body_text")
  );
}

function emailBodyRenderFromAttrs(attrs: Record<string, unknown>): EmailBodyRender | null {
  const value = getSingleAttrValue(attrs, "body_render_json");
  if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks
    .map(normalizeEmailRenderBlock)
    .filter((block): block is EmailBodyRenderBlock => Boolean(block));
  return { version: 1, blocks };
}

function normalizeEmailRenderBlock(value: unknown): EmailBodyRenderBlock | null {
  if (!isPlainObject(value) || typeof value.type !== "string") return null;
  if (value.type === "forwarded_header") {
    if (!isPlainObject(value.fields)) return null;
    const fields = Object.fromEntries(
      Object.entries(value.fields)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, fieldValue]) => [key.toLowerCase(), fieldValue.trim()])
    );
    return Object.keys(fields).length > 0 ? { type: "forwarded_header", fields } : null;
  }

  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return null;
  if (value.type === "paragraph") {
    const segments = normalizeEmailTextSegments(value.segments);
    return { type: "paragraph", text, ...(segments ? { segments } : {}) };
  }
  if (value.type === "quote") {
    const rawDepth = typeof value.depth === "number" ? value.depth : 1;
    const depth = Number.isFinite(rawDepth) ? Math.max(1, Math.min(Math.round(rawDepth), 4)) : 1;
    return { type: "quote", text, depth };
  }
  if (value.type === "signature") return { type: "signature", text };
  if (value.type === "disclaimer") return { type: "disclaimer", text };
  return null;
}

function emailAttachmentsFromAttrs(attrs: Record<string, unknown>): EmailAttachmentMetadata[] {
  const raw = attrs.attachments_json;
  const value = Array.isArray(raw) && raw.every(isPlainObject) ? raw : getSingleAttrValue(attrs, "attachments_json");
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const filename = typeof item.filename === "string" ? item.filename.trim() : "";
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim() : "";
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
    if (!filename && !mimeType) return [];
    return [{ ...(filename ? { filename } : {}), ...(mimeType ? { mimeType } : {}), ...(size != null ? { size } : {}) }];
  });
}

function emailRenderPreview(renderBody: EmailBodyRender | null): string {
  const paragraph = renderBody?.blocks.find((block) => block.type === "paragraph");
  return paragraph ? paragraph.text : "";
}

function renderEmailText(block: { text: string; segments?: EmailBodyTextSegment[] }): ReactNode[] {
  if (!block.segments?.length) return linkifyText(block.text);
  return block.segments.map((segment, index) => {
    if (!segment.href) return segment.text;
    return (
      <a key={`segment-${index}`} href={normalizeLinkHref(segment.href)} target="_blank" rel="noreferrer">
        {segment.text}
      </a>
    );
  });
}

function normalizeEmailTextSegments(value: unknown): EmailBodyTextSegment[] | null {
  if (!Array.isArray(value)) return null;
  const segments = value.flatMap((item) => {
    if (!isPlainObject(item) || typeof item.text !== "string") return [];
    const text = item.text;
    const href = typeof item.href === "string" ? item.href.trim() : "";
    if (!text) return [];
    return [{ text, ...(href ? { href } : {}) }];
  });
  return segments.some((segment) => segment.href) ? segments : null;
}

function isEmailDetailBlock(block: EmailBodyRenderBlock): boolean {
  return block.type === "quote" || block.type === "signature" || block.type === "disclaimer";
}

function emailBlockText(block: EmailBodyRenderBlock): string {
  return block.type === "forwarded_header" ? Object.values(block.fields).join(" ") : block.text;
}

function forwardedHeaderEntries(fields: Record<string, string>): Array<[string, string]> {
  const labels: Record<string, string> = {
    from: "From",
    date: "Date",
    subject: "Subject",
    to: "To",
    cc: "Cc",
    bcc: "Bcc"
  };
  return ["from", "date", "subject", "to", "cc", "bcc"]
    .filter((key) => fields[key])
    .map((key) => [labels[key] ?? key, fields[key]!] as [string, string]);
}

function attachmentLabel(attachment: EmailAttachmentMetadata): string {
  const name = attachment.filename || attachment.mimeType || "Attachment";
  return attachment.size != null ? `${name} · ${formatBytes(attachment.size)}` : name;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  renderSecondary,
  renderAction
}: {
  items: RelatedRecord[];
  empty: string;
  renderPrimary: (item: RelatedRecord) => string;
  renderSecondary: (item: RelatedRecord) => string;
  renderAction?: (item: RelatedRecord) => ReactNode;
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
        const action = renderAction?.(item);
        return (
          <li key={item.id} className="related-list__item">
            <div className="related-list__row">
              <div className="related-list__primary">{renderPrimary(item)}</div>
              {action}
            </div>
            {secondary && <div className="related-list__secondary">{secondary}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function uniqueNonEmpty(values: string[]): string[] {
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

function emailHref(value: string): string {
  const match = value.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return `mailto:${match?.[0] ?? value}`;
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
          push(Mail, item, emailHref(item));
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

function ContactSection({ rows }: { rows: ContactRow[] }) {
  return (
    <section className="detail__contact-section">
      <MonoLabel>Contact</MonoLabel>
      {rows.length === 0 ? (
        <div className="empty-inline">
          <span>no contact info on file</span>
        </div>
      ) : (
        <div className="detail__contact">
          {rows.map((row, index) => (
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
    </section>
  );
}

function scalarText(value: unknown): string {
  return getScalar({ value }, "value");
}

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function externalUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
