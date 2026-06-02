import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  Workspace,
  createRecord,
  ensureSignalAttributes,
  finishSignalJob,
  importCsv,
  importTranscript,
  listRunningSignalJobs,
  loadSignalDefinitions,
  runSignals,
  updateRecord,
  writeSignalJobState
} from "@agent-crm/sdk";
import { ensureWorkspaceIdentity as ensureSdkWorkspaceIdentity } from "@agent-crm/sdk/workspace/identity.js";
import type {
  CommunicationThreadMessagesResult,
  CompanyTeamResult,
  CreateRecordPayload,
  ImportCsvPayload,
  PersonCompanyResult,
  PersonRelatedObject,
  PersonRelatedResult,
  RecordLabel,
  RecordLabelsResult,
  RecordListOptions,
  RecordListResult,
  RecordPreview,
  RecordValue,
  RelatedRecord,
  SchemaObject,
  SignalRunFailureSummary,
  SignalRunJob,
  SignalRunRequest,
  TranscriptPayload,
  UpdateRecordPayload,
  WorkspaceSummary
} from "./shared/types.js";

let workspace: Workspace | null = null;
let workspacePath: string | null = null;
let workspaceDatabaseUrl: string | null = null;
let workspaceName: string | null = null;
let signalJobQueue = Promise.resolve();
let schemaObjectsCache: SchemaObject[] | null = null;

const DEFAULT_RECORD_LIMIT = 100;
const MAX_RECORD_LIMIT = 250;

type RpcRequest = {
  id: number;
  method: string;
  params?: unknown[];
};

type WorkspaceRequest = {
  databaseUrl: string;
  workspaceDir: string;
  name: string;
};

function normalizePath(filePath: string) {
  return path.resolve(filePath);
}

function normalizeWorkspaceRequest(input: unknown): WorkspaceRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Workspace request must include a database URL.");
  }
  const candidate = input as Partial<WorkspaceRequest>;
  if (typeof candidate.databaseUrl !== "string" || candidate.databaseUrl.trim().length === 0) {
    throw new Error("Workspace request must include a database URL.");
  }
  if (typeof candidate.workspaceDir !== "string" || candidate.workspaceDir.trim().length === 0) {
    throw new Error("Workspace request must include a workspace directory.");
  }
  const name = typeof candidate.name === "string" && candidate.name.trim().length > 0
    ? candidate.name.trim()
    : "Agent CRM";
  return {
    databaseUrl: candidate.databaseUrl.trim(),
    workspaceDir: normalizePath(candidate.workspaceDir),
    name
  };
}

async function closeWorkspaceHandle() {
  schemaObjectsCache = null;
  workspacePath = null;
  workspaceDatabaseUrl = null;
  workspaceName = null;
  if (!workspace) return;
  await workspace.close();
  workspace = null;
}

function assertWorkspace(): Workspace {
  if (!workspace) {
    throw new Error("No workspace database is open.");
  }
  return workspace;
}

async function ensureWorkspaceIdentity(): Promise<string> {
  return ensureSdkWorkspaceIdentity(assertWorkspace());
}

async function openWorkspaceAt(input: unknown) {
  await closeWorkspaceHandle();
  const request = normalizeWorkspaceRequest(input);
  await fs.mkdir(request.workspaceDir, { recursive: true });
  schemaObjectsCache = null;
  workspace = await Workspace.open(request.databaseUrl);
  workspacePath = request.workspaceDir;
  workspaceDatabaseUrl = request.databaseUrl;
  workspaceName = request.name;
  return getWorkspaceSummary();
}

async function createWorkspaceAt(input: unknown) {
  await closeWorkspaceHandle();
  const request = normalizeWorkspaceRequest(input);
  await fs.mkdir(request.workspaceDir, { recursive: true });
  schemaObjectsCache = null;
  workspace = await Workspace.create(request.databaseUrl);
  workspacePath = request.workspaceDir;
  workspaceDatabaseUrl = request.databaseUrl;
  workspaceName = request.name;
  return getWorkspaceSummary();
}

async function getSchemaObjects(): Promise<SchemaObject[]> {
  if (schemaObjectsCache) return schemaObjectsCache;
  const current = assertWorkspace();
  const objects = await loadSchemaObjects(current);
  schemaObjectsCache = objects;
  return objects;
}

async function executeWorkspaceRead(
  current: Workspace,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: Record<string, unknown>[]; rowsAffected: number }> {
  const db = (current as unknown as {
    db?: {
      execute: (
        sql: string,
        params?: ReadonlyArray<unknown>
      ) => Promise<{
        rows: Array<Record<string, unknown> | { toObject: () => Record<string, unknown> }>;
        rowsAffected: number;
      }>;
    };
  }).db;
  if (!db) {
    throw new Error("The active Agent CRM workspace does not expose a queryable local store.");
  }
  const result = await db.execute(sql, params);
  return {
    rows: result.rows.map((row) => typeof (row as { toObject?: unknown }).toObject === "function"
      ? (row as { toObject: () => Record<string, unknown> }).toObject()
      : row as Record<string, unknown>),
    rowsAffected: result.rowsAffected
  };
}

async function loadSchemaObjects(current: Workspace): Promise<SchemaObject[]> {
  const [objects, attrs] = await Promise.all([
    executeWorkspaceRead(
      current,
      `SELECT object_slug, singular_name, plural_name
       FROM acrm_object
       ORDER BY object_slug`
    ),
    executeWorkspaceRead(
      current,
      `SELECT object_slug, attribute_slug, title, attribute_type,
              is_multivalued, is_unique, config_json
       FROM acrm_attribute
       ORDER BY object_slug, attribute_slug`
    )
  ]);
  const byObject = new Map<string, SchemaObject["attributes"]>();
  for (const row of attrs.rows) {
    const objectSlug = String(row.object_slug);
    const list = byObject.get(objectSlug) ?? [];
    const config = parseSchemaConfig(row.config_json);
    list.push({
      attribute_slug: String(row.attribute_slug),
      title: String(row.title),
      attribute_type: String(row.attribute_type),
      is_multivalued: Boolean(row.is_multivalued),
      is_unique: Boolean(row.is_unique),
      ...(config !== undefined ? { config } : {})
    });
    byObject.set(objectSlug, list);
  }
  return objects.rows.map((row) => ({
    object_slug: String(row.object_slug),
    singular_name: String(row.singular_name),
    plural_name: String(row.plural_name),
    attributes: byObject.get(String(row.object_slug)) ?? []
  }));
}

function parseSchemaConfig(raw: unknown): unknown | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function getWorkspaceSummary(): Promise<WorkspaceSummary> {
  const current = assertWorkspace();
  const objects = await getSchemaObjects();
  const counts = await countRecords(current);

  return {
    path: workspacePath ?? "",
    databaseUrl: workspaceDatabaseUrl ?? "",
    filename: workspaceName ?? "Untitled workspace",
    objects,
    counts
  };
}

async function summarizeWorkspaceAt(databaseUrl: string): Promise<Pick<WorkspaceSummary, "counts">> {
  const current = await Workspace.open(databaseUrl);
  try {
    return { counts: await countRecords(current) };
  } finally {
    await current.close();
  }
}

function getSignalsDir(): string {
  if (!workspacePath) {
    throw new Error("No workspace database is open.");
  }
  return path.join(workspacePath, "signals");
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
    throw new Error("No workspace database is open.");
  }
  return path.join(workspacePath, ".cache", "signals");
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
    throw new Error("No workspace database is open.");
  }
  const workspaceFile = localWorkspaceFile();
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
  const jobs = await listRunningSignalJobs(localWorkspaceFile());
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
    if (!workspace || !workspacePath || localWorkspaceFile() !== workspaceFile) {
      throw new Error("Signal run workspace is no longer open.");
    }
    const result = await runSignals(workspace, {
      signalsDir: getSignalsDir(),
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
    if (workspacePath && localWorkspaceFile() === workspaceFile) {
      send({ event: "workspaceChanged", workspacePath });
    }
  }
}

function localWorkspaceFile(): string {
  if (!workspacePath) {
    throw new Error("No workspace database is open.");
  }
  return path.join(workspacePath, ".agent-crm-workspace");
}

async function countRecords(current: Workspace): Promise<Record<string, number>> {
  const result = await executeWorkspaceRead(
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
  const searchTerms = normalizeRecordSearchTerms(options.searchQuery);
  const searchPatterns = searchTerms.map((term) => `%${escapeSqlLike(term)}%`);
  const params = [
    objectSlug,
    ...(cursor ? [cursor] : []),
    ...attributeSlugs,
    ...searchPatterns
  ];
  const cursorClause = cursor ? "AND r.record_id < $2" : "";
  const attrStart = cursor ? 3 : 2;
  const attributeFilter =
    attributeSlugs.length > 0
      ? `AND v.attribute_slug IN (${attributeSlugs
          .map((_, index) => `$${attrStart + index}`)
          .join(", ")})`
      : "";
  const searchStart = attrStart + attributeSlugs.length;
  const searchClause = recordSearchClause({
    recordAlias: "r",
    valueAliasPrefix: "sv",
    attributeSlugs,
    attrStart,
    searchStart,
    searchTermCount: searchTerms.length
  });
  const result = await executeWorkspaceRead(
    current,
    `WITH selected AS (
       SELECT r.object_slug, r.record_id
         FROM acrm_record r
        WHERE r.object_slug = $1
          ${cursorClause}
          ${searchClause}
        ORDER BY r.record_id DESC
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
  const totalMatches =
    searchTerms.length > 0
      ? await countSearchMatches(current, objectSlug, attributeSlugs, searchPatterns)
      : undefined;
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
    hasMore: selectedRows.length > limit,
    ...(totalMatches !== undefined ? { totalMatches } : {})
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

function normalizeRecordSearchTerms(query: unknown): string[] {
  if (typeof query !== "string") return [];
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => term.slice(0, 80));
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function recordSearchClause({
  recordAlias,
  valueAliasPrefix,
  attributeSlugs,
  attrStart,
  searchStart,
  searchTermCount
}: {
  recordAlias: string;
  valueAliasPrefix: string;
  attributeSlugs: string[];
  attrStart: number;
  searchStart: number;
  searchTermCount: number;
}) {
  if (searchTermCount === 0) return "";
  const attrClause =
    attributeSlugs.length > 0
      ? (alias: string) =>
          `AND ${alias}.attribute_slug IN (${attributeSlugs
            .map((_, index) => `$${attrStart + index}`)
            .join(", ")})`
      : () => "";
  return Array.from({ length: searchTermCount })
    .map((_, index) => {
      const valueAlias = `${valueAliasPrefix}${index}`;
      return `AND EXISTS (
            SELECT 1
              FROM acrm_value ${valueAlias}
             WHERE ${valueAlias}.object_slug = ${recordAlias}.object_slug
               AND ${valueAlias}.record_id = ${recordAlias}.record_id
               AND ${valueAlias}.active_until IS NULL
               ${attrClause(valueAlias)}
               AND lower(CAST(${valueAlias}.value_json AS TEXT)) LIKE $${searchStart + index} ESCAPE '\\'
          )`;
    })
    .join("\n          ");
}

async function countSearchMatches(
  current: Workspace,
  objectSlug: string,
  attributeSlugs: string[],
  searchPatterns: string[]
): Promise<number> {
  const attrStart = 2;
  const searchStart = attrStart + attributeSlugs.length;
  const result = await executeWorkspaceRead(
    current,
    `SELECT COUNT(*) AS count
       FROM acrm_record r
      WHERE r.object_slug = $1
        ${recordSearchClause({
          recordAlias: "r",
          valueAliasPrefix: "csv",
          attributeSlugs,
          attrStart,
          searchStart,
          searchTermCount: searchPatterns.length
        })}`,
    [objectSlug, ...attributeSlugs, ...searchPatterns]
  );
  return Number(result.rows[0]?.count ?? 0);
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
    communication_messages: ["subject", "snippet", "body_preview", "body_text"],
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
  const values = await executeWorkspaceRead(
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
  }>,
  options: { valueLimit?: number } = {}
): Promise<RecordPreview[]> {
  const valueLimit = options.valueLimit ?? 10;
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
      values: Number.isFinite(valueLimit) ? list.slice(0, valueLimit) : list
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

  const valueRows = await executeWorkspaceRead(
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

async function getPersonRelated(
  personRecordId: string,
  childObject: PersonRelatedObject
): Promise<PersonRelatedResult> {
  const current = assertWorkspace();
  const relation = personRelation(childObject);
  const direct = await executeWorkspaceRead(
    current,
    `SELECT v.ref_record_id AS rec_id,
            tv.attribute_slug AS attr,
            tv.value_json AS val,
            tv.ref_object AS ref_object,
            tv.ref_record_id AS ref_record_id
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
    [personRecordId, relation.childObject, relation.personAttribute]
  );
  const inverse = await executeWorkspaceRead(
    current,
    `SELECT v.record_id AS rec_id,
            tv.attribute_slug AS attr,
            tv.value_json AS val,
            tv.ref_object AS ref_object,
            tv.ref_record_id AS ref_record_id
       FROM acrm_value v
       LEFT JOIN acrm_value tv
         ON tv.object_slug = $2
        AND tv.record_id = v.record_id
        AND tv.active_until IS NULL
      WHERE v.object_slug = $2
        AND v.attribute_slug = $3
        AND v.ref_object = 'people'
        AND v.ref_record_id = $1
        AND v.active_until IS NULL`,
    [personRecordId, relation.childObject, relation.childAttribute]
  );
  return {
    object: childObject,
    records: relatedRowsToRecords([...direct.rows, ...inverse.rows])
  };
}

async function getCompanyTeam(companyRecordId: string): Promise<CompanyTeamResult> {
  const current = assertWorkspace();
  const [companyTeamResult, peopleCompanyResult] = await Promise.all([
    executeWorkspaceRead(
      current,
      `SELECT v.ref_record_id AS record_id
         FROM acrm_value v
        WHERE v.object_slug = 'companies'
          AND v.record_id = $1
          AND v.attribute_slug = 'team'
          AND v.ref_object = 'people'
          AND v.active_until IS NULL`,
      [companyRecordId]
    ),
    executeWorkspaceRead(
      current,
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
  const recordIds = uniqueStrings(
    [...companyTeamResult.rows, ...peopleCompanyResult.rows].map((row) =>
      row.record_id == null ? "" : String(row.record_id)
    )
  );
  if (recordIds.length === 0) return { records: [] };
  const where = recordIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await executeWorkspaceRead(
    current,
    `SELECT record_id AS rec_id, attribute_slug AS attr, value_json AS val
       FROM acrm_value
      WHERE object_slug = 'people'
        AND record_id IN (${where})
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
    recordIds
  );
  const byId = new Map(relatedRowsToRecords(result.rows).map((record) => [record.id, record]));
  return {
    records: recordIds.map((id) => byId.get(id) ?? { id, attrs: {} })
  };
}

async function getCommunicationThreadMessages(
  threadRecordId: string
): Promise<CommunicationThreadMessagesResult> {
  const result = await executeWorkspaceRead(
    assertWorkspace(),
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
  return { records: relatedRowsToRecords(result.rows) };
}

async function getRecordLabels(
  objectSlug: string,
  recordIds: string[]
): Promise<RecordLabelsResult> {
  const unique = uniqueStrings(recordIds);
  const labels = await resolveReferenceLabels(
    assertWorkspace(),
    new Set(unique.map((recordId) => `${objectSlug}:${recordId}`))
  );
  return {
    labels: unique.map((recordId): RecordLabel => ({
      object_slug: objectSlug,
      record_id: recordId,
      label: labels.get(`${objectSlug}:${recordId}`) ?? recordId.slice(0, 8)
    }))
  };
}

async function getPersonCompany(personRecordId: string): Promise<PersonCompanyResult> {
  const result = await executeWorkspaceRead(
    assertWorkspace(),
    `SELECT pv.ref_record_id AS company_record_id,
            cv.value_json AS company_name
       FROM acrm_value pv
       LEFT JOIN acrm_value cv
         ON cv.object_slug = 'companies'
        AND cv.record_id = pv.ref_record_id
        AND cv.attribute_slug = 'name'
        AND cv.active_until IS NULL
      WHERE pv.object_slug = 'people'
        AND pv.record_id = $1
        AND pv.attribute_slug = 'company'
        AND pv.active_until IS NULL
      LIMIT 1`,
    [personRecordId]
  );
  const row = result.rows[0];
  return {
    company_record_id: typeof row?.company_record_id === "string" ? row.company_record_id : null,
    name: scalarText(parseValue(row?.company_name)) || null
  };
}

function relatedRowsToRecords(rows: Record<string, unknown>[]): RelatedRecord[] {
  const map = new Map<string, RelatedRecord>();
  for (const row of rows) {
    const id = row.rec_id == null ? "" : String(row.rec_id);
    if (!id) continue;
    let entry = map.get(id);
    if (!entry) {
      entry = { id, attrs: {} };
      map.set(id, entry);
    }
    if (row.attr == null) continue;
    const ref = row.ref_record_id && row.ref_object
      ? { target_object: String(row.ref_object), target_record_id: String(row.ref_record_id) }
      : null;
    pushAttrValue(entry.attrs, String(row.attr), ref ?? parseValue(row.val));
  }
  return [...map.values()];
}

function pushAttrValue(attrs: Record<string, unknown>, key: string, value: unknown): void {
  const existing = attrs[key];
  if (existing === undefined) {
    attrs[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    attrs[key] = [existing, value];
  }
}

function personRelation(childObject: PersonRelatedObject): {
  childObject: PersonRelatedObject;
  personAttribute: string;
  childAttribute: string;
} {
  if (childObject === "transcripts") {
    return { childObject, personAttribute: "associated_transcripts", childAttribute: "participants" };
  }
  if (childObject === "posts") {
    return { childObject, personAttribute: "associated_posts", childAttribute: "author" };
  }
  return { childObject, personAttribute: "communication_threads", childAttribute: "participants" };
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

function scalarText(value: unknown): string {
  return displayValue(value).trim();
}

async function dispatch(method: string, params: unknown[] = []) {
  switch (method) {
    case "openWorkspace":
      return openWorkspaceAt(params[0]);
    case "createWorkspace":
      return createWorkspaceAt(params[0]);
    case "closeWorkspace":
      return closeWorkspaceHandle();
    case "getWorkspace":
      return workspace ? getWorkspaceSummary() : null;
    case "summarizeWorkspace":
      return summarizeWorkspaceAt(String(params[0]));
    case "ensureWorkspaceIdentity":
      return ensureWorkspaceIdentity();
    case "listRecords":
      return listRecordsForObject(String(params[0]), (params[1] ?? {}) as RecordListOptions);
    case "createRecord": {
      schemaObjectsCache = null;
      const result = await createRecord(assertWorkspace(), params[0] as CreateRecordPayload);
      return result;
    }
    case "updateRecord": {
      const result = await updateRecord(assertWorkspace(), params[0] as UpdateRecordPayload);
      return result;
    }
    case "importCsv": {
      schemaObjectsCache = null;
      const result = await importCsv(assertWorkspace(), params[0] as ImportCsvPayload);
      return result;
    }
    case "importTranscript": {
      schemaObjectsCache = null;
      const result = await importTranscript(assertWorkspace(), params[0] as TranscriptPayload);
      return result;
    }
    case "importCommunicationBatch": {
      schemaObjectsCache = null;
      const expectedWorkspacePath = typeof params[1] === "string" ? normalizePath(params[1]) : null;
      if (expectedWorkspacePath && workspacePath !== expectedWorkspacePath) {
        throw new Error("Workspace changed before communication import could run.");
      }
      const sdk = await import("@agent-crm/sdk") as unknown as {
        importCommunicationBatch: (workspace: Workspace, batch: unknown) => Promise<unknown>;
      };
      const result = await sdk.importCommunicationBatch(assertWorkspace(), params[0]);
      return result;
    }
    case "getPersonRelated":
      return getPersonRelated(String(params[0]), params[1] as PersonRelatedObject);
    case "getCompanyTeam":
      return getCompanyTeam(String(params[0]));
    case "getCommunicationThreadMessages":
      return getCommunicationThreadMessages(String(params[0]));
    case "getRecordLabels":
      return getRecordLabels(String(params[0]), (params[1] ?? []) as string[]);
    case "getPersonCompany":
      return getPersonCompany(String(params[0]));
    case "listSignals":
      return listSignalDefinitions();
    case "listSignalFailures":
      return listSignalFailures();
    case "listSignalRuns":
      return listSignalRuns();
    case "syncSignals": {
      schemaObjectsCache = null;
      const result = await syncSignalDefinitions();
      return result;
    }
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
