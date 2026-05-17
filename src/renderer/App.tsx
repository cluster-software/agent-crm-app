import {
  Archive,
  Braces,
  Building2,
  ChevronDown,
  Circle,
  Columns3,
  Database,
  FileText,
  FileInput,
  FilePlus2,
  FolderOpen,
  Handshake,
  Layers3,
  ListPlus,
  Loader2,
  Newspaper,
  Play,
  Plus,
  Search,
  Send,
  Table2,
  Upload,
  Users,
  Waypoints,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api, isPreviewMode } from "./api";
import type {
  CreateRecordPayload,
  ImportCsvResult,
  QueryResult,
  RecordPreview,
  TranscriptImportResult,
  TranscriptPayload,
  WorkspaceSummary
} from "../shared/types";

type ImportMode = "csv" | "transcript";

type SchemaObject = WorkspaceSummary["objects"][number];

const sdkObjectOrder = [
  "companies",
  "people",
  "deals",
  "posts",
  "transcripts"
];

const defaultQuery = `SELECT object_slug, COUNT(*) AS records
FROM acrm_record
GROUP BY object_slug
ORDER BY object_slug;`;

const defaultCsv = `email,first_name,last_name,company,domain,job_title,deal_name,deal_stage
maya@lumin.ai,Maya,Chen,Lumin AI,lumin.ai,VP Sales,Expansion,In Progress`;

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
    setLoading("Opening workspace");
    setError(null);
    try {
      const summary = await action();
      if (summary) {
        setWorkspace(summary);
        setSelectedObjectSlug(defaultObjectSlug(orderSchemaObjects(summary.objects)));
      }
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-space" />
        <div className="brand">
          <div className="brand-mark">
            <Database size={16} />
          </div>
          <div>
            <div className="brand-title">Agent CRM</div>
            <div className="brand-subtitle">SDK Console</div>
          </div>
        </div>

        <nav className="nav-list">
          <div className="sidebar-section-label">Schema</div>
          {schemaObjects.length > 0 ? (
            schemaObjects.map((object) => {
              const Icon = iconForObject(object.object_slug);
              const active = selectedObject?.object_slug === object.object_slug;
              const count = workspace?.counts[object.object_slug] ?? 0;
              return (
                <button
                  className={`nav-item object-nav-item ${active ? "active" : ""}`}
                  key={object.object_slug}
                  onClick={() => setSelectedObjectSlug(object.object_slug)}
                >
                  <Icon size={15} />
                  <span className="nav-object-copy">
                    <span className="nav-object-title">{object.plural_name}</span>
                    <span className="nav-object-slug">{object.object_slug}</span>
                  </span>
                  <span className="nav-count">{formatNumber(count)}</span>
                </button>
              );
            })
          ) : (
            <div className="sidebar-empty">Open a workspace to load SDK objects.</div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-chip">
            <Circle size={8} className={workspace ? "online" : "idle"} fill="currentColor" />
            <span>{workspace ? workspace.filename : "No workspace"}</span>
          </div>
          {isPreviewMode && <div className="preview-badge">Browser preview</div>}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="location">
            <span className="crumb">Schema</span>
            <ChevronDown size={14} />
            <strong>{selectedObject?.plural_name ?? workspace?.filename ?? "Not connected"}</strong>
          </div>
          <div className="toolbar">
            <button
              className="icon-button"
              title="Open workspace"
              onClick={() => runWorkspaceAction(api.openWorkspaceDialog)}
            >
              <FolderOpen size={15} />
              <span>Open</span>
            </button>
            <button
              className="primary-button"
              title="Create workspace"
              onClick={() => runWorkspaceAction(api.createWorkspaceDialog)}
            >
              <FilePlus2 size={15} />
              <span>Create</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="error-strip">
            <span>{error}</span>
            <button onClick={() => setError(null)} title="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {loading && (
          <div className="loading-strip">
            <Loader2 size={14} className="spin" />
            <span>{loading}</span>
          </div>
        )}

        <section className="content">
          {!workspace ? (
            <EmptyWorkspace
              onOpen={() => runWorkspaceAction(api.openWorkspaceDialog)}
              onCreate={() => runWorkspaceAction(api.createWorkspaceDialog)}
            />
          ) : selectedObject ? (
            <RecordsView
              workspace={workspace}
              objectSlug={selectedObject.object_slug}
              onChanged={refreshWorkspace}
              setError={setError}
            />
          ) : (
            <EmptyWorkspace
              onOpen={() => runWorkspaceAction(api.openWorkspaceDialog)}
              onCreate={() => runWorkspaceAction(api.createWorkspaceDialog)}
            />
          )}
        </section>
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

function iconForObject(objectSlug: string) {
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
      <div className="empty-icon">
        <Database size={30} />
      </div>
      <h1>Connect an Agent CRM workspace</h1>
      <p>Open an existing `.acrm` file or create a fresh workspace seeded by the SDK.</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={onCreate}>
          <FilePlus2 size={15} />
          <span>Create workspace</span>
        </button>
        <button className="icon-button" onClick={onOpen}>
          <FolderOpen size={15} />
          <span>Open workspace</span>
        </button>
      </div>
    </div>
  );
}

function Overview({ workspace }: { workspace: WorkspaceSummary }) {
  const totalRecords = Object.values(workspace.counts).reduce((sum, value) => sum + value, 0);

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
          <p>{workspace.path}</p>
        </div>
        <div className="summary-pill">
          <Layers3 size={14} />
          <span>{workspace.objects.length} objects</span>
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Records" value={formatNumber(totalRecords)} detail="Across all objects" />
        <Metric label="Active values" value={formatNumber(workspace.activeValues)} detail="Current EAV values" />
        <Metric label="Schema objects" value={formatNumber(workspace.objects.length)} detail="SDK registered" />
        <Metric label="Largest object" value={largestObjectLabel(workspace)} detail="By record count" />
      </div>

      <div className="split-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>Object Counts</h2>
          </div>
          <div className="object-list">
            {workspace.objects.map((object) => (
              <div className="object-row" key={object.object_slug}>
                <div>
                  <strong>{object.plural_name}</strong>
                  <span>{object.object_slug}</span>
                </div>
                <b>{formatNumber(workspace.counts[object.object_slug] ?? 0)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Recent Records</h2>
          </div>
          <RecordList records={workspace.recent} compact />
        </section>
      </div>
    </div>
  );
}

function largestObjectLabel(workspace: WorkspaceSummary) {
  const [slug, count] = Object.entries(workspace.counts).sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
  if (!count) return "None";
  const object = workspace.objects.find((item) => item.object_slug === slug);
  return object?.plural_name ?? slug;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function RecordsView({
  workspace,
  objectSlug,
  onChanged,
  setError
}: {
  workspace: WorkspaceSummary;
  objectSlug: string;
  onChanged: () => Promise<WorkspaceSummary | null>;
  setError: (error: string | null) => void;
}) {
  const [records, setRecords] = useState<RecordPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const object = workspace.objects.find((item) => item.object_slug === objectSlug) ?? workspace.objects[0];

  const loadRecords = useCallback(async () => {
    if (!objectSlug) return;
    setLoading(true);
    try {
      setRecords(await api.listRecords(objectSlug));
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setLoading(false);
    }
  }, [objectSlug, setError]);

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

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>{object?.plural_name ?? "Records"}</h1>
          <p>{object?.singular_name ?? "Object"} records from the SDK schema.</p>
        </div>
        <button className="primary-button" onClick={() => setShowCreate(true)}>
          <Plus size={15} />
          <span>New record</span>
        </button>
      </div>

      <div className="records-toolbar">
        <div className="object-context">
          <Columns3 size={14} />
          <span>{object?.object_slug ?? objectSlug}</span>
          <b>{object?.attributes.length ?? 0} attributes</b>
        </div>
        <div className="search-shell">
          <Search size={14} />
          <span>{formatNumber(workspace.counts[objectSlug] ?? 0)} records</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>{object?.plural_name ?? objectSlug}</h2>
          {loading && <Loader2 size={14} className="spin" />}
        </div>
        <RecordList records={records} />
      </section>

      {showCreate && object && (
        <CreateRecordModal
          object={object}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

function RecordList({ records, compact = false }: { records: RecordPreview[]; compact?: boolean }) {
  if (records.length === 0) {
    return (
      <div className="empty-inline">
        <Archive size={17} />
        <span>No records yet</span>
      </div>
    );
  }

  return (
    <div className={`record-list ${compact ? "compact" : ""}`}>
      {records.map((record) => (
        <article className="record-row" key={`${record.object_slug}:${record.record_id}`}>
          <div className="record-main">
            <div className="record-title">{record.label}</div>
            <div className="record-subtitle">{record.subtitle}</div>
          </div>
          <div className="record-values">
            {record.values.slice(0, compact ? 2 : 4).map((value) => (
              <span key={value.attribute_slug}>
                <b>{value.title}</b>
                {value.display}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
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
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <h2>New {object.singular_name}</h2>
            <p>Use SDK field syntax: attribute=value.</p>
          </div>
          <button type="button" className="ghost-icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <textarea
          className="code-input"
          value={fields}
          onChange={(event) => setFields(event.target.value)}
          spellCheck={false}
        />
        <div className="attribute-hints">
          {object.attributes.map((attribute) => (
            <span key={attribute.attribute_slug}>{attribute.attribute_slug}</span>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="icon-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <ListPlus size={15} />}
            <span>Create</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportView({
  workspace,
  onChanged,
  setError
}: {
  workspace: WorkspaceSummary;
  onChanged: () => Promise<WorkspaceSummary | null>;
  setError: (error: string | null) => void;
}) {
  const [mode, setMode] = useState<ImportMode>("csv");
  const [csvText, setCsvText] = useState(defaultCsv);
  const [source, setSource] = useState("electron");
  const [transcript, setTranscript] = useState<TranscriptPayload>({
    source: "manual",
    source_id: `manual-${Date.now()}`,
    title: "Discovery call",
    participants: [{ email: "maya@lumin.ai" }],
    summary: "",
    content: ""
  });
  const [busy, setBusy] = useState(false);
  const [csvResult, setCsvResult] = useState<ImportCsvResult | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptImportResult | null>(null);

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "csv") {
        setCsvResult(await api.importCsv({ csvText, source }));
      } else {
        setTranscriptResult(await api.importTranscript(transcript));
      }
      await onChanged();
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Import</h1>
          <p>Write into {workspace.filename} through SDK import operations.</p>
        </div>
        <div className="segmented">
          <button className={mode === "csv" ? "active" : ""} onClick={() => setMode("csv")}>
            CSV
          </button>
          <button className={mode === "transcript" ? "active" : ""} onClick={() => setMode("transcript")}>
            Transcript
          </button>
        </div>
      </div>

      {mode === "csv" ? (
        <section className="panel import-panel">
          <div className="form-grid">
            <label>
              <span>Source</span>
              <input value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
          </div>
          <textarea
            className="code-input large"
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            spellCheck={false}
          />
          <div className="form-actions">
            <button className="primary-button" onClick={runImport} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
              <span>Import CSV</span>
            </button>
          </div>
          {csvResult && (
            <ResultStrip
              items={[
                ["Rows", csvResult.stats.rows],
                ["People", csvResult.stats.people_created],
                ["Companies", csvResult.stats.companies_created],
                ["Deals", csvResult.stats.deals_created]
              ]}
            />
          )}
        </section>
      ) : (
        <section className="panel import-panel">
          <div className="form-grid two">
            <label>
              <span>Source</span>
              <input
                value={transcript.source}
                onChange={(event) => setTranscript({ ...transcript, source: event.target.value })}
              />
            </label>
            <label>
              <span>Source ID</span>
              <input
                value={transcript.source_id}
                onChange={(event) => setTranscript({ ...transcript, source_id: event.target.value })}
              />
            </label>
            <label>
              <span>Title</span>
              <input
                value={transcript.title ?? ""}
                onChange={(event) => setTranscript({ ...transcript, title: event.target.value })}
              />
            </label>
            <label>
              <span>Participants</span>
              <input
                value={transcript.participants.map((item) => item.email ?? item.linkedin_url ?? item.twitter_url ?? "").join(", ")}
                onChange={(event) =>
                  setTranscript({
                    ...transcript,
                    participants: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (item.includes("@") ? { email: item } : { linkedin_url: item }))
                  })
                }
              />
            </label>
          </div>
          <textarea
            className="code-input large"
            placeholder="Transcript content"
            value={transcript.content ?? ""}
            onChange={(event) => setTranscript({ ...transcript, content: event.target.value })}
          />
          <textarea
            className="code-input"
            placeholder="Summary"
            value={transcript.summary ?? ""}
            onChange={(event) => setTranscript({ ...transcript, summary: event.target.value })}
          />
          <div className="form-actions">
            <button className="primary-button" onClick={runImport} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
              <span>Import transcript</span>
            </button>
          </div>
          {transcriptResult && (
            <ResultStrip
              items={[
                ["Created", transcriptResult.created ? "Yes" : "No"],
                ["Resolved", transcriptResult.participants.resolved.length],
                ["Unresolved", transcriptResult.participants.unresolved.length]
              ]}
            />
          )}
        </section>
      )}
    </div>
  );
}

function ResultStrip({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div className="result-strip">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function QueryView({ setError }: { setError: (error: string | null) => void }) {
  const [sql, setSql] = useState(defaultQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function runQuery() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.runQuery(sql));
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(() => {
    if (!result?.rows.length) return [];
    return Object.keys(result.rows[0]);
  }, [result]);

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Query</h1>
          <p>Run SQL directly against the workspace through `query()`.</p>
        </div>
        <button className="primary-button" onClick={runQuery} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          <span>Run</span>
        </button>
      </div>

      <section className="panel query-panel">
        <textarea
          className="code-input query"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          spellCheck={false}
        />
        <div className="query-meta">
          <span>{result ? `${result.rows.length} rows` : "Ready"}</span>
          <span>{result ? `${result.rowsAffected} rows affected` : "Read and write queries use SDK execution"}</span>
        </div>
        {result && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column}>{formatCell(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SchemaView({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <h1>Schema</h1>
          <p>Default and custom objects registered in this workspace.</p>
        </div>
      </div>

      <div className="schema-grid">
        {workspace.objects.map((object) => (
          <section className="schema-object" key={object.object_slug}>
            <div className="schema-object-heading">
              <div>
                <h2>{object.plural_name}</h2>
                <span>{object.object_slug}</span>
              </div>
              <strong>{object.attributes.length}</strong>
            </div>
            <div className="attribute-list">
              {object.attributes.map((attribute) => (
                <div className="attribute-row" key={attribute.attribute_slug}>
                  <div>
                    <strong>{attribute.title}</strong>
                    <span>{attribute.attribute_slug}</span>
                  </div>
                  <div className="attribute-tags">
                    <em>{attribute.attribute_type}</em>
                    {attribute.is_unique && <em>unique</em>}
                    {attribute.is_multivalued && <em>multi</em>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
