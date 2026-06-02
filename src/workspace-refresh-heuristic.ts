export const TERMINAL_WORKSPACE_REFRESH_DELAY_MS = 1_500;
export const TERMINAL_WORKSPACE_REFRESH_BURST_INTERVAL_MS = 2_000;
export const TERMINAL_WORKSPACE_REFRESH_BURST_DURATION_MS = 120_000;

// TODO: Replace this demo-time terminal-output wakeup with a backend-provided
// workspace revision/change signal so refreshes are driven by persisted DB state.
export function terminalOutputMayChangeWorkspace(output: string): boolean {
  const text = output
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .toLowerCase();
  return (
    /\bacrm\b[\s\S]{0,300}\b(import|deals|records|signals)\b/.test(text) ||
    /background command[\s\S]{0,160}completed/.test(text) ||
    /import complete|people created|companies created|deals created|all \d+ deals are created/.test(text) ||
    /created from your recent linkedin|created and enriched|pipeline is live/.test(text) ||
    /message-history backfill started|pipeline set|workspace changed/.test(text) ||
    /"ok"\s*:\s*true/.test(text)
  );
}
