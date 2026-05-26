import { readFile } from "node:fs/promises";

const sdk = await import("@agent-crm/sdk");

const instructions = sdk.AGENT_WORKSPACE_INSTRUCTIONS;

function fail(message) {
  console.error(`[agent-instructions] ${message}`);
  process.exit(1);
}

if (!instructions || typeof instructions !== "object") {
  fail("@agent-crm/sdk does not export AGENT_WORKSPACE_INSTRUCTIONS.");
}

if (!Array.isArray(instructions.filenames)) {
  fail("AGENT_WORKSPACE_INSTRUCTIONS.filenames must be an array.");
}

for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
  if (!instructions.filenames.includes(filename)) {
    fail(`AGENT_WORKSPACE_INSTRUCTIONS.filenames must include ${filename}.`);
  }
}

for (const key of ["startMarker", "endMarker", "block"]) {
  if (typeof instructions[key] !== "string" || instructions[key].length === 0) {
    fail(`AGENT_WORKSPACE_INSTRUCTIONS.${key} must be a non-empty string.`);
  }
}

if (!instructions.block.includes(instructions.startMarker)) {
  fail("AGENT_WORKSPACE_INSTRUCTIONS.block must include startMarker.");
}

if (!instructions.block.includes(instructions.endMarker)) {
  fail("AGENT_WORKSPACE_INSTRUCTIONS.block must include endMarker.");
}

if (!instructions.block.includes("## Agent CRM Workspace")) {
  fail("AGENT_WORKSPACE_INSTRUCTIONS.block must include the Agent CRM workspace heading.");
}

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const forbiddenMainSourceSnippets = [
  "const agentWorkspaceGuideNames",
  "const agentWorkspaceGuideStart",
  "const agentWorkspaceGuideEnd",
  "const agentWorkspaceGuide =",
  "This directory is managed by Agent CRM."
];
for (const snippet of forbiddenMainSourceSnippets) {
  if (mainSource.includes(snippet)) {
    fail("src/main.ts contains the legacy hardcoded workspace guide; use the SDK-backed instruction writer instead.");
  }
}

console.log("[agent-instructions] SDK export is available.");
