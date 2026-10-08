"use client";

import { useSyncExternalStore } from "react";

/**
 * Read a browser-storage value as React state, without an effect.
 *
 * `useEffect(() => setX(localStorage.getItem(...)), [])` is the usual way to
 * read storage after mount, and it renders once with the wrong value and then
 * again with the right one. A store subscription avoids that: the server
 * snapshot is `undefined` ("not known yet"), and the client reads the real
 * value on its first render and re-renders when it changes, in this tab or
 * another.
 */

const listeners = new Map<string, Set<() => void>>();

function subscribeTo(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  // Another tab writing the same key fires a `storage` event here.
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set!.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked (private mode, site data off): behave as if nothing is saved.
    return null;
  }
}

/** Write (or clear, with null) a value and tell every subscriber in this tab. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; subscribers still re-read, and see nothing saved.
  }
  listeners.get(key)?.forEach((cb) => cb());
}

/** The stored string, `null` when nothing is saved, or `undefined` before the
 * client has read it (server render, hydration). */
export function useStoredValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    (cb) => subscribeTo(key, cb),
    () => read(key),
    () => undefined,
  );
}

/** True once running in the browser. A hydration-safe replacement for the
 * `mounted` state flag that is set from an effect. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
