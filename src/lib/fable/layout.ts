"use client";

import { useSyncExternalStore } from "react";

/**
 * The console's layout, chosen in Settings and remembered in this browser.
 *
 * - soft: rounded cards, soft depth, the lavender canvas. The default.
 * - sharp: square corners, hairline rules, no shadows, neutral greys.
 * - compact: an icon rail instead of the full sidebar, flat panels and tighter
 *   spacing on the same neutral greys as sharp, so more of every page fits.
 *
 * A per-viewer preference, so it lives in localStorage: a different member of
 * the same bank keeps their own choice.
 */
export type ConsoleLayout = "soft" | "sharp" | "compact";

export const LAYOUTS: { id: ConsoleLayout; name: string; summary: string }[] = [
  { id: "soft", name: "Soft", summary: "Rounded cards and soft depth on a tinted canvas." },
  { id: "sharp", name: "Sharp", summary: "Square corners, hairline rules, no shadows. Editorial and precise." },
  { id: "compact", name: "Compact", summary: "An icon rail, flat panels and tighter spacing for more on screen." },
];

const KEY = "fable_console_layout";
const listeners = new Set<() => void>();

function read(): ConsoleLayout {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "sharp" || value === "compact" ? value : "soft";
  } catch {
    return "soft";
  }
}

export function setConsoleLayout(layout: ConsoleLayout): void {
  try {
    window.localStorage.setItem(KEY, layout);
  } catch {
    // Storage blocked: the choice still applies until the page reloads.
  }
  current = layout;
  listeners.forEach((l) => l());
}

let current: ConsoleLayout | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = read();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useConsoleLayout(): ConsoleLayout {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= read()),
    () => "soft",
  );
}
