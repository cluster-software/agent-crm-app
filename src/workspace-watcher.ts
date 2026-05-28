import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";

const DEBOUNCE_MS = 250;

export interface WorkspaceWatcher {
  start(filePath: string): void;
  stop(): void;
}

// Watches a .acrm file for out-of-process writes (e.g. the `acrm` CLI running
// inside the embedded terminal) and invokes `onChange` after a short debounce.
// The trailing debounce waits for a quiet period instead of forcing periodic
// reads during a long SQLite write. We watch the parent directory so SQLite
// sidecar files (`-wal`, `-shm`, `-journal`) trigger events even if they don't
// exist when the workspace is first opened.
export function createWorkspaceWatcher(onChange: () => void): WorkspaceWatcher {
  let currentPath: string | null = null;
  let watcher: FSWatcher | null = null;
  let trailingTimer: NodeJS.Timeout | null = null;

  function emit() {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    onChange();
  }

  function scheduleEmit() {
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(emit, DEBOUNCE_MS);
  }

  function stop() {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // already closed
      }
      watcher = null;
    }
    currentPath = null;
  }

  function start(filePath: string) {
    if (currentPath === filePath && watcher) return;
    stop();
    currentPath = filePath;

    const dir = dirname(filePath);
    const target = basename(filePath);
    const relevant = new Set([
      target,
      `${target}-wal`,
      `${target}-shm`,
      `${target}-journal`
    ]);

    try {
      const fsw = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename && relevant.has(filename)) scheduleEmit();
      });
      fsw.on("error", (err) => {
        console.warn(`[workspace-watcher] ${dir}: ${err.message}`);
        try {
          fsw.close();
        } catch {
          // already closed
        }
        if (watcher === fsw) watcher = null;
      });
      watcher = fsw;
    } catch (err) {
      console.warn(
        `[workspace-watcher] failed to watch ${dir}: ${(err as Error).message}`
      );
    }
  }

  return { start, stop };
}
