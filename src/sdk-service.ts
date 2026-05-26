import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  Workspace,
  createRecord,
  dumpSchema,
  ensureSignalAttributes,
  finishSignalJob,
  importCsv,
  importTranscript,
  listRunningSignalJobs,
  loadSignalDefinitions,
  query,
  runSignals,
  writeSignalJobState
} from "@agent-crm/sdk";
import { ensureWorkspaceIdentity as ensureSdkWorkspaceIdentity } from "@agent-crm/sdk/workspace/identity.js";
import type {
  CreateRecordPayload,
  ImportCsvPayload,
  QueryResult,
  RecordListOptions,
  RecordListResult,
  RecordPreview,
  RecordValue,
  SchemaObject,
  SignalRunFailureSummary,
  SignalRunJob,
  SignalRunRequest,
  TranscriptPayload,
  WorkspaceSummary
} from "./shared/types.js";

let workspace: Workspace | null = null;
let workspacePath: string | null = null;
let signalJobQueue = Promise.resolve();
let schemaObjectsCache: SchemaObject[] | null = null;

const DEFAULT_RECORD_LIMIT = 100;
const MAX_RECORD_LIMIT = 250;

type RpcRequest = {
  id: number;
  method: string;
  params?: unknown[];
};

function normalizePath(filePath: string) {
  return path.resolve(filePath);
}

async function closeWorkspaceHandle() {
  schemaObjectsCache = null;
  if (!workspace) return;
  await workspace.close();
  workspace = null;
  workspacePath = null;
}

function assertWorkspace(): Workspace {
  if (!workspace) {
    throw new Error("No .acrm workspace is open.");
  }
  return workspace;
}

async function ensureWorkspaceIdentity(): Promise<string> {
  return ensureSdkWorkspaceIdentity(assertWorkspace());
}

async function openWorkspaceAt(filePath: string) {
  await closeWorkspaceHandle();
  const absolutePath = normalizePath(filePath);
  schemaObjectsCache = null;
  workspace = await Workspace.open(absolutePath);
  workspacePath = absolutePath;
  return getWorkspaceSummary();
}

async function createWorkspaceAt(filePath: string) {
  await closeWorkspaceHandle();
  const absolutePath = normalizePath(filePath);
  schemaObjectsCache = null;
  workspace = await Workspace.create(absolutePath);
  workspacePath = absolutePath;
  return getWorkspaceSummary();
}

async function getSchemaObjects(): Promise<SchemaObject[]> {
  if (schemaObjectsCache) return schemaObjectsCache;
  const current = assertWorkspace();
  const schema = await dumpSchema(current);
  schemaObjectsCache = schema.objects;
  return schema.objects;
}

async function getWorkspaceSummary(): Promise<WorkspaceSummary> {
  const current = assertWorkspace();
  const objects = await getSchemaObjects();
  const counts = await countRecords(current);

  return {
    path: workspacePath ?? "",
    filename: workspacePath ? path.basename(workspacePath) : "Untitled workspace",
    objects,
    counts
  };
}

function getSignalsDir(): string {
  if (!workspacePath) {
    throw new Error("No .acrm workspace is open.");
  }
  return path.join(path.dirname(workspacePath), "signals");
}

async function listSignalDefinitions() {
  if (!workspacePath) return [];
  const definitions = await loadSignalDefinitions(getSignalsDir());
  return definitions.map((definition) => ({
    slug: definition.slug,
    title: definition.title,
    object_slug: definition.object_slug,
    outputs: definition.outputs
  }));
}

async function listSignalFailures(): Promise<SignalRunFailureSummary[]> {
  if (!workspacePath) return [];
  const dir = getSignalsCacheDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const latest = new Map<string, { time: number; failure: SignalRunFailureSummary | null }>();
  for (const name of entries) {
    if (!name.endsWith(".log")) continue;
    const logPath = path.join(dir, name);
    const stat = await fs.stat(logPath).catch(() => null);
    const time = stat?.mtimeMs ?? 0;
    const text = await fs.readFile(logPath, "utf8").catch(() => "");
    const parsed = parseLastJsonLine(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const root = parsed as Record<string, unknown>;
    if (root.ok !== true) continue;
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? root.data as Record<string, unknown>
      : null;
    if (!data) continue;
    const failures = failureMap(data.failures, logPath);
    const statuses = Array.isArray(data.statuses) ? data.statuses : [];
    if (statuses.length > 0) {
      for (const status of statuses) {
        const item = parseSignalStatus(status);
        if (!item) continue;
        const key = signalFailureKey(item);
        const current = latest.get(key);
        if (current && current.time > time) continue;
        latest.set(key, {
          time,
          failure: item.status === "failed" ? failures.get(key) ?? null : null
        });
      }
      continue;
    }
    for (const [key, failure] of failures) {
      const current = latest.get(key);
      if (current && current.time > time) continue;
      latest.set(key, { time, failure });
    }
  }
  return Array.from(latest.values()).flatMap((entry) => entry.failure ? [entry.failure] : []);
}

function failureMap(raw: unknown, logPath: string): Map<string, SignalRunFailureSummary> {
  const out = new Map<string, SignalRunFailureSummary>();
  if (!Array.isArray(raw)) return out;
  for (const failure of raw) {
    if (!failure || typeof failure !== "object" || Array.isArray(failure)) continue;
    const item = failure as Record<string, unknown>;
    if (
      (item.object_slug === "people" || item.object_slug === "companies") &&
      typeof item.record_id === "string" &&
      typeof item.signal_slug === "string" &&
      typeof item.message === "string"
    ) {
      const parsed: SignalRunFailureSummary = {
        object_slug: item.object_slug,
        record_id: item.record_id,
        signal_slug: item.signal_slug,
        message: item.message,
        ...(typeof item.stdout_excerpt === "string" ? { stdout_excerpt: item.stdout_excerpt } : {}),
        ...(typeof item.stderr_excerpt === "string" ? { stderr_excerpt: item.stderr_excerpt } : {}),
        log_path: logPath
      };
      out.set(signalFailureKey(parsed), parsed);
    }
  }
  return out;
}

function parseSignalStatus(raw: unknown): {
  object_slug: "people" | "companies";
  record_id: string;
  signal_slug: string;
  status: "succeeded" | "failed" | "skipped";
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (
    (item.object_slug === "people" || item.object_slug === "companies") &&
    typeof item.record_id === "string" &&
    typeof item.signal_slug === "string" &&
    (item.status === "succeeded" || item.status === "failed" || item.status === "skipped")
  ) {
    return {
      object_slug: item.object_slug,
      record_id: item.record_id,
      signal_slug: item.signal_slug,
      status: item.status
    };
  }
  return null;
}

function signalFailureKey(item: { object_slug: string; record_id: string; signal_slug: string }): string {
  return `${item.object_slug}:${item.record_id}:${item.signal_slug}`;
}

function parseLastJsonLine(text: string): unknown {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // keep looking
    }
  }
  return null;
}

async function syncSignalDefinitions() {
  const current = assertWorkspace();
  const definitions = await loadSignalDefinitions(getSignalsDir());
  const result = await ensureSignalAttributes(current, definitions);
  return {
    definitions: result.definitions,
    attributes_created: result.attributes_created,
    attributes_updated: result.attributes_updated
  };
}

function getSignalsCacheDir(): string {
  if (!workspacePath) {
    throw new Error("No .acrm workspace is open.");
  }
  return path.join(path.dirname(workspacePath), ".cache", "signals");
}

async function createSignalRunLogPath(): Promise<string> {
  const dir = getSignalsCacheDir();
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `ui-signals-${Date.now()}.log`);
}

async function writeSignalRunResultLog(
  logPath: string,
  result: Awaited<ReturnType<typeof runSignals>>,
): Promise<void> {
  await fs.appendFile(logPath, `${JSON.stringify({ ok: true, data: result })}\n`, "utf8");
}

async function runWorkspaceSignals(request: SignalRunRequest = {}) {
  if (!workspacePath) {
    throw new Error("No .acrm workspace is open.");
  }
  const workspaceFile = workspacePath;
  const jobId = `ui-signals-${Date.now()}`;
  const logPath = await createSignalRunLogPath();
  const job: SignalRunJob = {
    id: jobId,
    ...(request.object_slug ? { object_slug: request.object_slug } : {}),
    record_ids: request.record_ids ?? [],
    signalSlugs: request.signalSlugs ?? [],
    log_path: logPath,
    started_at: new Date().toISOString()
  };
  await writeSignalJobState(workspaceFile, {
    ...job,
    status: "running",
    source: "app",
    updated_at: job.started_at,
    pid: process.pid
  });
  signalJobQueue = signalJobQueue
    .catch(() => undefined)
    .then(() => runWorkspaceSignalJob(job.id, workspaceFile, request, logPath));
  return { started: true, job };
}

async function listSignalRuns(): Promise<SignalRunJob[]> {
  if (!workspacePath) return [];
  const jobs = await listRunningSignalJobs(workspacePath);
  return jobs.map((job) => ({
    id: job.id,
    ...(job.object_slug ? { object_slug: job.object_slug } : {}),
    record_ids: job.record_ids,
    signalSlugs: job.signalSlugs,
    log_path: job.log_path,
    started_at: job.started_at
  }));
}

async function runWorkspaceSignalJob(
  jobId: string,
  workspaceFile: string,
  request: SignalRunRequest,
  logPath: string,
): Promise<void> {
  const previousLogPath = process.env.ACRM_SIGNAL_LOG_PATH;
  process.env.ACRM_SIGNAL_LOG_PATH = logPath;
  try {
    if (!workspace || workspacePath !== workspaceFile) {
      throw new Error("Signal run workspace is no longer open.");
    }
    const result = await runSignals(workspace, {
      signalsDir: path.join(path.dirname(workspaceFile), "signals"),
      mode: request.mode,
      signalSlugs: request.signalSlugs,
      object_slug: request.object_slug,
      record_ids: request.record_ids,
      limit: request.limit,
      concurrency: request.concurrency
    });
    await writeSignalRunResultLog(logPath, result);
    await finishSignalJob(
      workspaceFile,
      jobId,
      result.runs_failed > 0 ? "failed" : "succeeded"
    );
  } catch (error) {
    await fs.appendFile(logPath, `${JSON.stringify({ ok: false, error: serializeError(error) })}\n`, "utf8")
      .catch(() => undefined);
    await finishSignalJob(
      workspaceFile,
      jobId,
      "failed",
      error instanceof Error ? error.message : String(error)
    ).catch(() => undefined);
  } finally {
    if (previousLogPath === undefined) delete process.env.ACRM_SIGNAL_LOG_PATH;
    else process.env.ACRM_SIGNAL_LOG_PATH = previousLogPath;
  }
}

async function countRecords(current: Workspace): Promise<Record<string, number>> {
  const result = await query(
    current,
    "SELECT object_slug, COUNT(*) AS count FROM acrm_record GROUP BY object_slug ORDER BY object_slug"
  );
  return Object.fromEntries(
    result.rows.map((row) => [String(row.object_slug), Number(row.count ?? 0)])
  );
}

async function listRecordsForObject(
  objectSlug: string,
  options: RecordListOptions = {}
): Promise<RecordListResult> {
  const current = assertWorkspace();
  const objects = await getSchemaObjects();
  const limit = normalizeRecordLimit(options.limit);
  const cursor = normalizeCursor(options.cursor);
  const fetchLimit = limit + 1;
  const attributeSlugs = relevantAttributeSlugs(
    objectSlug,
    options.valueAttributes,
    options.includeSecondaryLabels ?? true
  );
  const params = [
    objectSlug,
    ...(cursor ? [cursor] : []),
    ...attributeSlugs
  ];
  const cursorClause = cursor ? "AND record_id < $2" : "";
  const attrStart = cursor ? 3 : 2;
  const attributeFilter =
    attributeSlugs.length > 0
      ? `AND v.attribute_slug IN (${attributeSlugs
          .map((_, index) => `$${attrStart + index}`)
          .join(", ")})`
      : "";
  const result = await query(
    current,
    `WITH selected AS (
       SELECT object_slug, record_id
         FROM acrm_record
        WHERE object_slug = $1
          ${cursorClause}
        ORDER BY record_id DESC
        LIMIT ${fetchLimit}
     )
     SELECT s.object_slug, s.record_id, v.attribute_slug, v.value_json,
            v.source, v.provenance_json, v.active_from
       FROM selected s
       LEFT JOIN acrm_value v
         ON v.object_slug = s.object_slug
        AND v.record_id = s.record_id
        AND v.active_until IS NULL
        ${attributeFilter}
      ORDER BY s.record_id DESC, v.active_from DESC`,
    params
  );
  const rows = result.rows as Array<{
    object_slug: string;
    record_id: string;
    attribute_slug?: string | null;
    value_json?: unknown;
    source?: unknown;
    provenance_json?: unknown;
  }>;
  const selectedRows: Array<{ object_slug: string; record_id: string }> = [];
  const seenRecords = new Set<string>();
  for (const row of rows) {
    const key = `${row.object_slug}:${row.record_id}`;
    if (seenRecords.has(key)) continue;
    seenRecords.add(key);
    selectedRows.push({ object_slug: row.object_slug, record_id: row.record_id });
  }
  const pageRows = selectedRows.slice(0, limit);
  const pageKeys = new Set(pageRows.map((record) => `${record.object_slug}:${record.record_id}`));
  const valueRows = rows.filter(
    (row) => row.attribute_slug != null && pageKeys.has(`${row.object_slug}:${row.record_id}`)
  );
  const records = await inflateRecordValueRows(
    current,
    objects,
    pageRows,
    valueRows
  );

  return {
    objectSlug,
    records,
    limit,
    cursor,
    nextCursor: selectedRows.length > limit ? pageRows[pageRows.length - 1]?.record_id ?? null : null,
    hasMore: selectedRows.length > limit
  };
}

function normalizeRecordLimit(limit: unknown) {
  const parsed = typeof limit === "number" ? Math.floor(limit) : DEFAULT_RECORD_LIMIT;
  if (!Number.isFinite(parsed)) return DEFAULT_RECORD_LIMIT;
  return Math.min(MAX_RECORD_LIMIT, Math.max(1, parsed));
}

function normalizeCursor(cursor: unknown) {
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

function relevantAttributeSlugs(
  objectSlug: string,
  valueAttributes: unknown,
  includeSecondaryLabels: boolean
): string[] {
  const attrs = new Set([
    ...primaryLabelAttributeSlugs(objectSlug),
    ...(includeSecondaryLabels ? secondaryLabelAttributeSlugs(objectSlug) : [])
  ]);
  if (Array.isArray(valueAttributes)) {
    for (const attr of valueAttributes) {
      if (typeof attr === "string" && attr.length > 0) attrs.add(attr);
    }
  }
  return [...attrs];
}

function primaryLabelAttributeSlugs(objectSlug: string): string[] {
  const byObject: Record<string, string[]> = {
    people: ["name", "email_addresses", "linkedin_url"],
    companies: ["name", "domains", "linkedin_url"],
    deals: ["name", "stage"],
    communication_threads: ["subject", "snippet", "provider_thread_id"],
    communication_messages: ["subject", "snippet", "body_text"],
    posts: ["content", "url"],
    transcripts: ["title", "source_id"]
  };
  return byObject[objectSlug] ?? ["name"];
}

function secondaryLabelAttributeSlugs(objectSlug: string): string[] {
  const byObject: Record<string, string[]> = {
    people: ["job_title", "company"],
    companies: ["description", "domains"],
    deals: ["value", "close_date", "next_step"],
    communication_threads: ["channel", "last_message_at", "message_count"],
    communication_messages: ["channel", "direction", "sent_at"],
    posts: ["platform", "posted_at", "author"],
    transcripts: ["source", "started_at", "duration_seconds"]
  };
  return byObject[objectSlug] ?? [];
}

async function inflateRecords(
  current: Workspace,
  objects: SchemaObject[],
  records: Array<{ object_slug: string; record_id: string }>,
  attributeSlugs?: string[]
): Promise<RecordPreview[]> {
  if (records.length === 0) {
    return [];
  }

  const attributeFilter =
    attributeSlugs && attributeSlugs.length > 0
      ? `AND v.attribute_slug IN (${attributeSlugs
          .map((_, index) => `$${records.length * 2 + index + 1}`)
          .join(", ")})`
      : "";
  const values = await query(
    current,
    `SELECT v.object_slug, v.record_id, v.attribute_slug, v.value_json,
            v.source, v.provenance_json
       FROM acrm_value v
      WHERE v.active_until IS NULL
        AND (${records.map((_, index) => `(v.object_slug = $${index * 2 + 1} AND v.record_id = $${index * 2 + 2})`).join(" OR ")})
        ${attributeFilter}
      ORDER BY v.active_from DESC`,
    [
      ...records.flatMap((record) => [record.object_slug, record.record_id]),
      ...(attributeSlugs ?? [])
    ]
  );

  return inflateRecordValueRows(
    current,
    objects,
    records,
    values.rows as Array<{
      object_slug: unknown;
      record_id: unknown;
      attribute_slug?: unknown;
      value_json?: unknown;
      source?: unknown;
      provenance_json?: unknown;
    }>
  );
}

async function inflateRecordValueRows(
  current: Workspace,
  objects: SchemaObject[],
  records: Array<{ object_slug: string; record_id: string }>,
  valueRows: Array<{
    object_slug: unknown;
    record_id: unknown;
    attribute_slug?: unknown;
    value_json?: unknown;
    source?: unknown;
    provenance_json?: unknown;
    title?: unknown;
    attribute_type?: unknown;
  }>
): Promise<RecordPreview[]> {
  const schemaByObject = new Map(objects.map((object) => [object.object_slug, object]));
  const grouped = new Map<string, RecordValue[]>();
  const attributeByObject = new Map(
    objects.map((object) => [
      object.object_slug,
      new Map(object.attributes.map((attribute) => [attribute.attribute_slug, attribute]))
    ])
  );

  for (const row of valueRows) {
    if (row.attribute_slug == null) continue;
    const key = `${row.object_slug}:${row.record_id}`;
    const attributeSlug = String(row.attribute_slug);
    const attribute = attributeByObject.get(String(row.object_slug))?.get(attributeSlug);
    const parsed = parseValue(row.value_json);
    const value: RecordValue = {
      attribute_slug: attributeSlug,
      title: attribute?.title ?? attributeSlug,
      type: attribute?.attribute_type ?? "",
      display: displayValue(parsed),
      raw: parsed,
      values: [parsed],
      source: typeof row.source === "string" ? row.source : null,
      provenance: parseObject(row.provenance_json)
    };
    const list = grouped.get(key) ?? [];
    const existing = list.find((item) => item.attribute_slug === value.attribute_slug);
    if (existing) {
      existing.values.push(parsed);
      existing.display = existing.values.map(displayValue).filter(Boolean).join(", ");
    } else {
      list.push(value);
    }
    grouped.set(key, list);
  }

  // Resolve any record references in the loaded values (e.g. people.company ->
  // a companies record) to the target record's primary label, then patch each
  // affected value's `display` so the renderer shows the label instead of an
  // empty string or a raw UUID.
  const refKeys = new Set<string>();
  for (const list of grouped.values()) {
    for (const value of list) {
      for (const raw of value.values) {
        if (isRecordRef(raw)) refKeys.add(`${raw.target_object}:${raw.target_record_id}`);
      }
    }
  }
  const refLabels = await resolveReferenceLabels(current, refKeys);
  for (const list of grouped.values()) {
    for (const value of list) {
      const hasRef = value.values.some(isRecordRef);
      if (!hasRef) continue;
      const parts = value.values.map((raw) => resolveDisplay(raw, refLabels)).filter(Boolean);
      value.display = parts.join(", ");
    }
  }

  return records.map((record) => {
    const list = grouped.get(`${record.object_slug}:${record.record_id}`) ?? [];
    const object = schemaByObject.get(record.object_slug);
    const label = primaryLabel(record.object_slug, record.record_id, list);
    const subtitle = secondaryLabel(record.object_slug, object, list);
    return {
      object_slug: record.object_slug,
      record_id: record.record_id,
      label,
      subtitle,
      values: list.slice(0, 10)
    };
  });
}

function parseValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseObject(value: unknown): Record<string, unknown> | null {
  const parsed = parseValue(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(displayValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    // Record references (e.g. people.company → a company record) don't carry a
    // human-readable label; resolving the target's primary label is the caller's
    // job. Return empty so this value gets filtered out of joined subtitles.
    if ("target_record_id" in item) return "";
    const candidates = [
      item.full_name,
      item.value,
      item.title,
      item.email_address,
      item.domain,
      item.root_domain,
      item.date,
      item.timestamp,
      item.currency_value
    ];
    const found = candidates.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).length > 0);
    if (found !== undefined) {
      return String(found);
    }
    return "";
  }
  return String(value);
}

function findDisplay(values: RecordValue[], attr: string) {
  return values.find((value) => value.attribute_slug === attr)?.display ?? "";
}

type RecordRef = { target_object: string; target_record_id: string };

function isRecordRef(value: unknown): value is RecordRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.target_record_id === "string" && typeof item.target_object === "string";
}

function resolveDisplay(value: unknown, refLabels: Map<string, string>): string {
  if (Array.isArray(value)) {
    return value.map((v) => resolveDisplay(v, refLabels)).filter(Boolean).join(", ");
  }
  if (isRecordRef(value)) {
    return refLabels.get(`${value.target_object}:${value.target_record_id}`) ?? "";
  }
  return displayValue(value);
}

async function resolveReferenceLabels(
  current: Workspace,
  refKeys: Set<string>
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (refKeys.size === 0) return labels;

  const pairs = Array.from(refKeys, (key) => {
    const idx = key.indexOf(":");
    return { object_slug: key.slice(0, idx), record_id: key.slice(idx + 1) };
  });

  const where = pairs
    .map((_, i) => `(v.object_slug = $${i * 2 + 1} AND v.record_id = $${i * 2 + 2})`)
    .join(" OR ");
  const attributeSlugs = [...new Set(pairs.flatMap((p) => primaryLabelAttributeSlugs(p.object_slug)))];
  const attributeFilter =
    attributeSlugs.length > 0
      ? `AND v.attribute_slug IN (${attributeSlugs
          .map((_, index) => `$${pairs.length * 2 + index + 1}`)
          .join(", ")})`
      : "";
  const params = [...pairs.flatMap((p) => [p.object_slug, p.record_id]), ...attributeSlugs];

  const valueRows = await query(
    current,
    `SELECT v.object_slug, v.record_id, v.attribute_slug, v.value_json
       FROM acrm_value v
      WHERE v.active_until IS NULL
        AND (${where})
        ${attributeFilter}`,
    params
  );

  const grouped = new Map<string, RecordValue[]>();
  for (const row of valueRows.rows) {
    const key = `${row.object_slug}:${row.record_id}`;
    const parsed = parseValue(row.value_json);
    const list = grouped.get(key) ?? [];
    const slug = String(row.attribute_slug);
    const existing = list.find((item) => item.attribute_slug === slug);
    if (existing) {
      existing.values.push(parsed);
      existing.display = existing.values.map(displayValue).filter(Boolean).join(", ");
    } else {
      list.push({
        attribute_slug: slug,
        title: slug,
        type: "",
        display: displayValue(parsed),
        raw: parsed,
        values: [parsed]
      });
    }
    grouped.set(key, list);
  }

  for (const { object_slug, record_id } of pairs) {
    const key = `${object_slug}:${record_id}`;
    const list = grouped.get(key) ?? [];
    labels.set(key, primaryLabel(object_slug, record_id, list));
  }
  return labels;
}

function primaryLabel(objectSlug: string, recordId: string, values: RecordValue[]) {
  const label = primaryLabelAttributeSlugs(objectSlug)
    .map((attr) => findDisplay(values, attr))
    .find(Boolean);
  return label || recordId.slice(0, 8);
}

function secondaryLabel(objectSlug: string, object: SchemaObject | undefined, values: RecordValue[]) {
  const parts = secondaryLabelAttributeSlugs(objectSlug)
    .map((attr) => findDisplay(values, attr))
    .filter(Boolean)
    .slice(0, 2);
  return parts.join(" · ") || object?.singular_name || objectSlug;
}

async function dispatch(method: string, params: unknown[] = []) {
  switch (method) {
    case "openWorkspace":
      return openWorkspaceAt(String(params[0]));
    case "createWorkspace":
      return createWorkspaceAt(String(params[0]));
    case "closeWorkspace":
      return closeWorkspaceHandle();
    case "getWorkspace":
      return workspace ? getWorkspaceSummary() : null;
    case "ensureWorkspaceIdentity":
      return ensureWorkspaceIdentity();
    case "listRecords":
      return listRecordsForObject(String(params[0]), (params[1] ?? {}) as RecordListOptions);
    case "createRecord":
      schemaObjectsCache = null;
      return createRecord(assertWorkspace(), params[0] as CreateRecordPayload);
    case "importCsv":
      schemaObjectsCache = null;
      return importCsv(assertWorkspace(), params[0] as ImportCsvPayload);
    case "importTranscript":
      schemaObjectsCache = null;
      return importTranscript(assertWorkspace(), params[0] as TranscriptPayload);
    case "importCommunicationBatch": {
      schemaObjectsCache = null;
      const expectedWorkspacePath = typeof params[1] === "string" ? normalizePath(params[1]) : null;
      if (expectedWorkspacePath && workspacePath !== expectedWorkspacePath) {
        throw new Error("Workspace changed before communication import could run.");
      }
      const sdk = await import("@agent-crm/sdk") as unknown as {
        importCommunicationBatch: (workspace: Workspace, batch: unknown) => Promise<unknown>;
      };
      return sdk.importCommunicationBatch(assertWorkspace(), params[0]);
    }
    case "runQuery":
      return query(assertWorkspace(), String(params[0]), (params[1] ?? []) as never[]) satisfies Promise<QueryResult>;
    case "listSignals":
      return listSignalDefinitions();
    case "listSignalFailures":
      return listSignalFailures();
    case "listSignalRuns":
      return listSignalRuns();
    case "syncSignals":
      return syncSignalDefinitions();
    case "runSignals":
      return runWorkspaceSignals((params[0] ?? {}) as SignalRunRequest);
    default:
      throw new Error(`Unknown SDK service method: ${method}`);
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

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

let queue = Promise.resolve();

rl.on("line", (line) => {
  queue = queue.then(async () => {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch (error) {
      send({
        id: 0,
        error: serializeError(new Error(`Invalid SDK service request: ${serializeError(error).message}`))
      });
      return;
    }

    try {
      const result = await dispatch(request.method, request.params);
      send({ id: request.id, result });
    } catch (error) {
      send({ id: request.id, error: serializeError(error) });
    }
  });
});

async function shutdown() {
  await closeWorkspaceHandle();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
