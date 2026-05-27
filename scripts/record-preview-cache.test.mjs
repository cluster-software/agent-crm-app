import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const electronBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);
const serviceScript = path.join(repoRoot, "dist", "electron", "sdk-service.js");

class SdkService {
  constructor() {
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.events = [];
    this.stderr = "";
    this.proc = spawn(electronBin, [serviceScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "0"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
  }

  request(method, ...params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.proc.stdin.write(`${payload}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out. stderr:\n${this.stderr}`));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  clearEvents() {
    this.events = [];
  }

  async waitForEvent(name, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.events.some((event) => event.event === name)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${name}. stderr:\n${this.stderr}`);
  }

  async close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("SDK service closed"));
    }
    this.pending.clear();
    if (this.proc.exitCode != null) return;
    this.proc.kill();
    await once(this.proc, "exit").catch(() => undefined);
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.onLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  onLine(line) {
    const message = JSON.parse(line);
    if (message.event) {
      this.events.push(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }
}

async function addPeopleTextAttribute(client, slug, title) {
  await client.request(
    "runQuery",
    `INSERT INTO acrm_attribute
      (object_slug, attribute_slug, title, attribute_type, is_multivalued, is_unique)
     VALUES ('people', $1, $2, 'text', false, false)`,
    [slug, title]
  );
}

function recordValue(record, attributeSlug) {
  return record.values.find((value) => value.attribute_slug === attributeSlug);
}

async function removeCache(workspaceFile) {
  const cacheDir = path.join(path.dirname(workspaceFile), ".cache", "agent-crm-app");
  await fs.rm(cacheDir, { recursive: true, force: true });
}

async function corruptCache(workspaceFile) {
  const dbPath = path.join(
    path.dirname(workspaceFile),
    ".cache",
    "agent-crm-app",
    "record-previews.sqlite"
  );
  await fs.rm(`${dbPath}-wal`, { force: true });
  await fs.rm(`${dbPath}-shm`, { force: true });
  await fs.writeFile(dbPath, "not sqlite");
}

test("record preview cache preserves values, scopes search, rebuilds after writes, and falls back on corruption", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-crm-cache-test-"));
  const workspaceFile = path.join(tempDir, "cache-test.acrm");
  let client = new SdkService();

  try {
    await client.request("createWorkspace", workspaceFile);
    for (let index = 1; index <= 12; index++) {
      const suffix = String(index).padStart(2, "0");
      await addPeopleTextAttribute(client, `custom_${suffix}`, `Custom ${suffix}`);
    }
    const createResult = await client.request("createRecord", {
      object_slug: "people",
      fields: [
        "name=Cache Target",
        "email_addresses=cache.target@example.com",
        "job_title=Invisible Needle",
        ...Array.from({ length: 12 }, (_, index) => {
          const suffix = String(index + 1).padStart(2, "0");
          return `custom_${suffix}=custom value ${suffix}`;
        })
      ],
      source: "record-preview-cache-test"
    });
    await client.request("closeWorkspace");
    await client.close();
    await removeCache(workspaceFile);

    client = new SdkService();
    const options = {
      limit: 100,
      valueAttributes: ["custom_12"],
      includeSecondaryLabels: false
    };
    await client.request("openWorkspace", workspaceFile);
    await client.request("listRecords", "people", options);
    await client.waitForEvent("recordIndexChanged");

    const cached = await client.request("listRecords", "people", options);
    assert.equal(cached.records.length, 1);
    assert.equal(recordValue(cached.records[0], "custom_12")?.display, "custom value 12");

    const hiddenSearch = await client.request("listRecords", "people", {
      limit: 100,
      valueAttributes: ["email_addresses"],
      includeSecondaryLabels: false,
      searchQuery: "needle"
    });
    assert.equal(hiddenSearch.records.length, 0);
    assert.equal(hiddenSearch.totalMatches, 0);

    const visibleSearch = await client.request("listRecords", "people", {
      limit: 100,
      valueAttributes: ["email_addresses"],
      includeSecondaryLabels: false,
      searchQuery: "cache.target"
    });
    assert.equal(visibleSearch.records.length, 1);
    assert.equal(visibleSearch.totalMatches, 1);

    client.clearEvents();
    await client.request("updateRecord", {
      object_slug: "people",
      record_id: createResult.record_id,
      fields: ["job_title=Updated Visible"],
      source: "record-preview-cache-test"
    });
    await client.waitForEvent("recordIndexChanged");
    const updated = await client.request("listRecords", "people", {
      limit: 100,
      valueAttributes: ["job_title"],
      includeSecondaryLabels: false
    });
    assert.equal(recordValue(updated.records[0], "job_title")?.display, "Updated Visible");

    await client.request("closeWorkspace");
    await client.close();
    await corruptCache(workspaceFile);

    client = new SdkService();
    await client.request("openWorkspace", workspaceFile);
    const fallback = await client.request("listRecords", "people", {
      limit: 100,
      valueAttributes: ["email_addresses"],
      includeSecondaryLabels: false
    });
    assert.equal(fallback.records.length, 1);
  } finally {
    await client.close().catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
