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
const databaseUrl = process.env.ACRM_TEST_DATABASE_URL;

class SdkService {
  constructor() {
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
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

test(
  "SDK service opens a Postgres workspace and writes records",
  { skip: databaseUrl ? false : "set ACRM_TEST_DATABASE_URL to run the Postgres SDK-service smoke test" },
  async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-crm-postgres-test-"));
    const client = new SdkService();

    try {
      const workspace = await client.request("createWorkspace", {
        databaseUrl,
        workspaceDir: tempDir,
        name: "Postgres smoke"
      });
      assert.equal(workspace.databaseUrl, databaseUrl);
      assert.equal(workspace.path, tempDir);
      assert.ok(workspace.objects.some((object) => object.object_slug === "people"));

      const suffix = `${Date.now()}-${Math.trunc(Math.random() * 1_000_000)}`;
      const smokeEmail = `postgres-smoke-${suffix}@example.com`;
      const created = await client.request("createRecord", {
        object_slug: "people",
        fields: [
          `name=Postgres Smoke ${suffix}`,
          `email_addresses=${smokeEmail}`
        ],
        source: "postgres-sdk-service-test"
      });
      assert.equal(created.created, true);

      const listed = await client.request("listRecords", "people", {
        limit: 10,
        valueAttributes: ["email_addresses"],
        searchQuery: smokeEmail
      });
      assert.equal(listed.records[0]?.record_id, created.record_id);

      const companyName = `Smoke Company ${suffix}`;
      const communicationEmail = `alice-${suffix}@example.com`;
      await client.request("importCommunicationBatch", {
        people: [{
          sourceKey: `gmail:smoke:${suffix}:email:${communicationEmail}`,
          email: communicationEmail,
          displayName: `Alice Smoke ${suffix}`,
          companySourceKey: `gmail:smoke:${suffix}:company`
        }],
        companies: [{
          sourceKey: `gmail:smoke:${suffix}:company`,
          domain: `company-${suffix}.example.com`,
          name: companyName
        }],
        communicationThreads: [{
          sourceKey: `gmail:smoke:${suffix}:thread`,
          provider: "gmail",
          channel: "email",
          providerAccountId: "me@example.com",
          providerThreadId: `thread-${suffix}`,
          subject: `Smoke thread ${suffix}`,
          participantSourceKeys: [`gmail:smoke:${suffix}:email:${communicationEmail}`]
        }],
        communicationMessages: [{
          sourceKey: `gmail:smoke:${suffix}:message`,
          provider: "gmail",
          channel: "email",
          providerAccountId: "me@example.com",
          providerMessageId: `message-${suffix}`,
          providerThreadId: `thread-${suffix}`,
          threadSourceKey: `gmail:smoke:${suffix}:thread`,
          subject: `Smoke message ${suffix}`,
          bodyPreview: `Hello from smoke ${suffix}`,
          senderSourceKey: `gmail:smoke:${suffix}:email:${communicationEmail}`,
          participantSourceKeys: [`gmail:smoke:${suffix}:email:${communicationEmail}`]
        }]
      });

      const people = await client.request("listRecords", "people", {
        limit: 10,
        searchQuery: communicationEmail
      });
      assert.equal(people.records[0]?.label, `Alice Smoke ${suffix}`);
      assert.match(people.records[0]?.subtitle ?? "", new RegExp(companyName));
      assert.doesNotMatch(people.records[0]?.label ?? "", /^[0-9a-f]{8}$/i);

      const threads = await client.request("listRecords", "communication_threads", {
        limit: 10,
        searchQuery: `Smoke thread ${suffix}`
      });
      assert.equal(threads.records[0]?.label, `Smoke thread ${suffix}`);

      const messages = await client.request("listRecords", "communication_messages", {
        limit: 10,
        searchQuery: `Smoke message ${suffix}`
      });
      assert.equal(messages.records[0]?.label, `Smoke message ${suffix}`);
    } finally {
      await client.close().catch(() => undefined);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
);
