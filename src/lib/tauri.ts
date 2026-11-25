import { invoke } from "@tauri-apps/api/core";

export interface AppBootstrapInfo {
  version: string;
  schemaVersion: number;
  dbPath: string;
  shellPath: string;
  theme: "dark" | "light" | string;
  adapters: string[];
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getBootstrapInfo(): Promise<AppBootstrapInfo> {
  if (!isTauriRuntime()) {
    return {
      version: "0.1.0",
      schemaVersion: 1,
      dbPath: "browser-preview://in-memory",
      shellPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
      theme: (localStorage.getItem("devdock.theme") as "dark" | "light") || "dark",
      adapters: ["node"],
    };
  }
  return invoke<AppBootstrapInfo>("get_bootstrap_info");
}

export async function refreshShellPath(): Promise<string> {
  if (!isTauriRuntime()) {
    return "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  }
  return invoke<string>("refresh_shell_path");
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(`devdock.${key}`, value);
    return;
  }
  await invoke("set_setting", { key, value });
}
