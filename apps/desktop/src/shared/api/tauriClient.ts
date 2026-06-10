import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function callTauri<TResponse>(command: string, args?: Record<string, unknown>) {
  return invoke<TResponse>(command, args);
}
