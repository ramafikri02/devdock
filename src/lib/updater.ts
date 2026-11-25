import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriRuntime } from "@/lib/tauri";

export interface AvailableUpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
  raw: Update;
}

export async function checkForAppUpdate(): Promise<AvailableUpdateInfo | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const update = await check();
  if (!update) {
    return null;
  }
  return {
    version: update.version,
    body: update.body ?? null,
    date: update.date ?? null,
    raw: update,
  };
}

export async function installAppUpdateAndRelaunch(
  update: Update,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  let contentLength: number | undefined;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = event.data.contentLength;
      onProgress?.(contentLength ? 0 : null);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      if (contentLength && contentLength > 0) {
        onProgress?.(Math.min(100, Math.round((downloaded / contentLength) * 100)));
      }
    } else if (event.event === "Finished") {
      onProgress?.(100);
    }
  });

  await relaunch();
}
