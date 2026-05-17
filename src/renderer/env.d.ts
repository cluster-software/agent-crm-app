import type { AppBridge, TerminalBridge } from "../shared/types";

declare global {
  interface Window {
    crm?: AppBridge;
    terminal?: TerminalBridge;
  }
}

export {};
