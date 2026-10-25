import type { MessageKey } from "./locales/en";

export const QAM_BLOCKS = [
  { id: "battery", label: "qam.battery" },
  { id: "flow", label: "page.flow" },
  { id: "estimate", label: "qam.eta" },
  { id: "charge-limit", label: "qam.chargeLimit" },
  { id: "timeline", label: "qam.lastDay" },
  { id: "games", label: "qam.gameActivity" },
  { id: "thermal", label: "qam.thermalMap" },
  { id: "fan", label: "fan.title" },
  { id: "specs", label: "qam.specs" },
  { id: "language", label: "lang.row" },
] as const satisfies readonly { id: string; label: MessageKey }[];

export type QamBlockId = typeof QAM_BLOCKS[number]["id"];
export const DEFAULT_QAM_ORDER: readonly QamBlockId[] = Object.freeze(QAM_BLOCKS.map((block) => block.id));
const storageKey = "power-timeline.qam-order";
const listeners = new Set<() => void>();

export function normalizeQamOrder(value: unknown): QamBlockId[] {
  const result: QamBlockId[] = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (DEFAULT_QAM_ORDER.includes(id) && !result.includes(id)) result.push(id);
    }
  }
  for (const id of DEFAULT_QAM_ORDER) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function readQamOrder(): readonly QamBlockId[] {
  try {
    const stored = localStorage.getItem(storageKey);
    return Object.freeze(normalizeQamOrder(stored === null ? null : JSON.parse(stored)));
  } catch {
    return DEFAULT_QAM_ORDER;
  }
}

let current = readQamOrder();

export function getQamOrder(): readonly QamBlockId[] {
  return current;
}

export function subscribeQamOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function saveQamOrder(order: readonly QamBlockId[]): void {
  const next = normalizeQamOrder(order);
  // Persist before publishing: a failed save must not change the running QAM.
  localStorage.setItem(storageKey, JSON.stringify(next));
  if (current.every((id, index) => next[index] === id)) return;
  current = Object.freeze(next);
  for (const listener of listeners) listener();
}
