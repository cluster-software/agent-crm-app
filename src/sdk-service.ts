import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  Workspace,
  createRecord,
  createWorkspace,
  dumpSchema,
  importCsv,
  importTranscript,
  query
} from "@agent-crm/sdk";
import type {
  CreateRecordPayload,
  ImportCsvPayload,
  QueryResult,
  RecordPreview,
  RecordValue,
  SchemaObject,
  TranscriptPayload,
  WorkspaceSummary
} from "./shared/types.js";

let workspace: Workspace | null = null;
let workspacePath: string | null = null;

type RpcRequest = {
  id: number;
  method: string;
  params?: unknown[];
};

function normalizePath(filePath: string) {
  return path.resolve(filePath);
}

async function closeWorkspaceHandle() {
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

async function openWorkspaceAt(filePath: string) {
  await closeWorkspaceHandle();
  const absolutePath = normalizePath(filePath);
  workspace = await Workspace.open(absolutePath);
  workspacePath = absolutePath;
  return getWorkspaceSummary();
}

async function createWorkspaceAt(filePath: string) {
  await closeWorkspaceHandle();
  const absolutePath = normalizePath(filePath);
  const created = await createWorkspace(absolutePath);
  workspace = created.workspace;
  workspacePath = absolutePath;
  return getWorkspaceSummary();
}

async function getSchemaObjects(): Promise<SchemaObject[]> {
  const current = assertWorkspace();
  const schema = await dumpSchema(current);
  return schema.objects;
}

async function getWorkspaceSummary(): Promise<WorkspaceSummary> {
  const current = assertWorkspace();
  const objects = await getSchemaObjects();
  const counts = await countRecords(current);
  const activeValues = await countActiveValues(current);
  const recent = await listRecentRecords(current, objects);

  return {
    path: workspacePath ?? "",
    filename: workspacePath ? path.basename(workspacePath) : "Untitled workspace",
    objects,
    counts,
    activeValues,
    recent
  };
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

async function countActiveValues(current: Workspace) {
  const result = await query(
    current,
    "SELECT COUNT(*) AS count FROM acrm_value WHERE active_until IS NULL"
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function listRecentRecords(current: Workspace, objects: SchemaObject[]) {
  const result = await query(
    current,
    `SELECT object_slug, record_id
       FROM acrm_record
      ORDER BY record_id DESC
      LIMIT 8`
  );
  return inflateRecords(current, objects, result.rows as Array<{ object_slug: string; record_id: string }>);
}

async function listRecordsForObject(objectSlug: string): Promise<RecordPreview[]> {
  const current = assertWorkspace();
  const objects = await getSchemaObjects();
  const result = await query(
    current,
    `SELECT object_slug, record_id
       FROM acrm_record
      WHERE object_slug = $1
      ORDER BY record_id DESC
      LIMIT 150`,
    [objectSlug]
  );
  return inflateRecords(current, objects, result.rows as Array<{ object_slug: string; record_id: string }>);
}

async function inflateRecords(
  current: Workspace,
  objects: SchemaObject[],
  records: Array<{ object_slug: string; record_id: string }>
): Promise<RecordPreview[]> {
  if (records.length === 0) {
    return [];
  }

  const values = await query(
    current,
    `SELECT v.object_slug, v.record_id, v.attribute_slug, v.value_json,
            a.title, a.attribute_type
       FROM acrm_value v
       JOIN acrm_attribute a
         ON a.object_slug = v.object_slug
        AND a.attribute_slug = v.attribute_slug
      WHERE v.active_until IS NULL
        AND (${records.map((_, index) => `(v.object_slug = $${index * 2 + 1} AND v.record_id = $${index * 2 + 2})`).join(" OR ")})
      ORDER BY v.active_from DESC`,
    records.flatMap((record) => [record.object_slug, record.record_id])
  );

  const schemaByObject = new Map(objects.map((object) => [object.object_slug, object]));
  const grouped = new Map<string, RecordValue[]>();

  for (const row of values.rows) {
    const key = `${row.object_slug}:${row.record_id}`;
    const parsed = parseValue(row.value_json);
    const value: RecordValue = {
      attribute_slug: String(row.attribute_slug),
      title: String(row.title ?? row.attribute_slug),
      type: String(row.attribute_type),
      display: displayValue(parsed),
      raw: parsed,
      values: [parsed]
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
    const candidates = [
      item.full_name,
      item.value,
      item.title,
      item.email_address,
      item.domain,
      item.root_domain,
      item.date,
      item.timestamp,
      item.currency_value,
      item.target_record_id
    ];
    const found = candidates.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).length > 0);
    if (found !== undefined) {
      return String(found);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function findDisplay(values: RecordValue[], attr: string) {
  return values.find((value) => value.attribute_slug === attr)?.display ?? "";
}

function primaryLabel(objectSlug: string, recordId: string, values: RecordValue[]) {
  const byObject: Record<string, string[]> = {
    people: ["name", "email_addresses", "linkedin_url"],
    companies: ["name", "domains", "linkedin_url"],
    deals: ["name", "stage"],
    posts: ["content", "url"],
    transcripts: ["title", "source_id"]
  };
  const label = (byObject[objectSlug] ?? ["name"])
    .map((attr) => findDisplay(values, attr))
    .find(Boolean);
  return label || recordId.slice(0, 8);
}

function secondaryLabel(objectSlug: string, object: SchemaObject | undefined, values: RecordValue[]) {
  const byObject: Record<string, string[]> = {
    people: ["job_title", "company", "twitter_url"],
    companies: ["description", "domains"],
    deals: ["value", "close_date", "next_step"],
    posts: ["platform", "posted_at", "author"],
    transcripts: ["source", "started_at", "duration_seconds"]
  };
  const parts = (byObject[objectSlug] ?? [])
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
    case "listRecords":
      return listRecordsForObject(String(params[0]));
    case "createRecord":
      return createRecord(assertWorkspace(), params[0] as CreateRecordPayload);
    case "importCsv":
      return importCsv(assertWorkspace(), params[0] as ImportCsvPayload);
    case "importTranscript":
      return importTranscript(assertWorkspace(), params[0] as TranscriptPayload);
    case "runQuery":
      return query(assertWorkspace(), String(params[0]), (params[1] ?? []) as never[]) satisfies Promise<QueryResult>;
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
    const request = JSON.parse(line) as RpcRequest;
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
