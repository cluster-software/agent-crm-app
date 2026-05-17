import type { AppBridge } from "../shared/types";

declare global {
  interface Window {
    crm?: AppBridge;
  }
}

export {};
