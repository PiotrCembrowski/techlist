"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";

export const TRAY_MAX = 4;
const STORAGE_KEY = "specbase.compare.v1";
const EVENT = "specbase:compare-tray";

const itemSchema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  brandName: z.string().min(1).max(120),
  href: z.string().startsWith("/"),
  topCategorySlug: z.string().min(1).max(120),
  topCategoryName: z.string().min(1).max(120),
  icon: z.string().max(64).nullable(),
});
export type TrayItem = z.infer<typeof itemSchema>;

const traySchema = z.array(itemSchema).max(TRAY_MAX);

export interface TrayState {
  items: TrayItem[];
  /** An item the user tried to add from a different top-level category, awaiting a decision. */
  pending: TrayItem | null;
  /** Set when the tray was full on the last add attempt. */
  full: boolean;
}

const EMPTY: TrayState = { items: [], pending: null, full: false };
let cachedRaw: string | null | undefined;
let cachedItems: TrayItem[] = [];
let pending: TrayItem | null = null;
let full = false;
let snapshot: TrayState = EMPTY;

/**
 * localStorage can throw (private mode, blocked storage). After the first failure the tray lives
 * in memory for the rest of the page view.
 */
let storageOk = true;
let memoryRaw: string | null = null;

function readRaw(): string | null {
  if (!storageOk) return memoryRaw;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    storageOk = false;
    return memoryRaw;
  }
}

function parse(raw: string | null): TrayItem[] {
  if (!raw) return [];
  try {
    const r = traySchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

function getSnapshot(): TrayState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedItems = parse(raw);
  }
  if (snapshot.items !== cachedItems || snapshot.pending !== pending || snapshot.full !== full) {
    snapshot = { items: cachedItems, pending, full };
  }
  return snapshot;
}

function getServerSnapshot(): TrayState {
  return EMPTY;
}

function notify() {
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function write(items: TrayItem[]) {
  const raw = JSON.stringify(items.slice(0, TRAY_MAX));
  memoryRaw = raw;
  if (storageOk) {
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      storageOk = false;
    }
  }
  notify();
}

export const compareTray = {
  /** Adds an item; refuses (and records why) when full or from another top-level category. */
  add(item: TrayItem): "added" | "exists" | "full" | "conflict" {
    const items = getSnapshot().items;
    if (items.some((i) => i.slug === item.slug)) return "exists";
    if (items.length > 0 && items[0]!.topCategorySlug !== item.topCategorySlug) {
      pending = item;
      full = false;
      notify();
      return "conflict";
    }
    if (items.length >= TRAY_MAX) {
      full = true;
      pending = null;
      notify();
      return "full";
    }
    full = false;
    pending = null;
    write([...items, item]);
    return "added";
  },
  remove(slug: string) {
    full = false;
    write(getSnapshot().items.filter((i) => i.slug !== slug));
  },
  /** Replace the whole tray (used when viewing a shared comparison URL). */
  replace(items: TrayItem[]) {
    const current = getSnapshot().items;
    if (current.length === items.length && current.every((c, i) => c.slug === items[i]!.slug))
      return;
    pending = null;
    full = false;
    write(items);
  },
  /** Start a new comparison with the pending item from another category. */
  acceptPending() {
    if (!pending) return;
    const item = pending;
    pending = null;
    write([item]);
  },
  dismiss() {
    pending = null;
    full = false;
    notify();
  },
  clear() {
    pending = null;
    full = false;
    write([]);
  },
};

export function useCompareTray(): TrayState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
