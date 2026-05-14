import { invoke } from "@tauri-apps/api/core";

export type InvokeArgs = Record<string, unknown> | undefined;

export function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  return invoke<T>(command, args);
}
