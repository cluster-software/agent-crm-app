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
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType, FormEvent } from "react";
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
    <div className="app-shell">
      <aside className="sidebar">
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

function RecordsTable({
  object,
  records,
  valueColumns
}: {
  object: SchemaObject;
  records: RecordPreview[];
  valueColumns: Array<[string, string]>;
}) {
  const columnTemplate = `28px minmax(220px, 1.6fr) ${valueColumns
    .map(() => "minmax(140px, 1fr)")
    .join(" ")}`;

  if (records.length === 0) {
    return (
      <>
        <div
          className="table__head"
          style={{ ["--columns" as string]: columnTemplate }}
        >
          <span />
          <span>{object.singular_name}</span>
          {valueColumns.map(([slug, title]) => (
            <span key={slug}>{title}</span>
          ))}
        </div>
        <div className="table__body">
          <div className="empty-inline">
            <span>no records yet · run an import or create one</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="table__head"
        style={{ ["--columns" as string]: columnTemplate }}
      >
        <span />
        <span>{object.singular_name}</span>
        {valueColumns.map(([slug, title]) => (
          <span key={slug}>{title}</span>
        ))}
      </div>
      <div className="table__body">
        {records.map((record, index) => (
          <div
            key={`${record.object_slug}:${record.record_id}`}
            className="table__row"
            data-touched={index === 0 ? "true" : undefined}
            style={{ ["--columns" as string]: columnTemplate }}
          >
            <span className="cell-check" />
            <span className="cell-identity">
              <IdentityMark object={object} name={record.label} />
              <span className="cell-identity__name">{record.label}</span>
              {record.subtitle && (
                <span className="cell-identity__domain">{record.subtitle}</span>
              )}
            </span>
            {valueColumns.map(([slug]) => (
              <ValueCell
                key={slug}
                value={record.values.find((value) => value.attribute_slug === slug)}
              />
            ))}
          </div>
        ))}
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

