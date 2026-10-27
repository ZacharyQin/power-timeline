import { useSyncExternalStore } from "react";
import { gameOverview } from "./gamePresentation";
import { en, type MessageKey } from "./locales/en";
import { es } from "./locales/es";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pt } from "./locales/pt";
import { zhCn } from "./locales/zh-cn";

export type Locale = "en" | "zh-cn" | "pt" | "es" | "ja" | "ko";
export const locales = ["zh-cn", "en", "pt", "es", "ja", "ko"] as const satisfies readonly Locale[];

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, "zh-cn": zhCn, pt, es, ja, ko };
const storageKey = "power-timeline.locale";
const listeners = new Set<() => void>();

function languageHints(): string[] {
  const hints: string[] = [];
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("LANGUAGE");
    if (fromQuery) hints.push(fromQuery);
    const manager = (window as { LocalizationManager?: { m_strLocale?: string; m_code?: string } }).LocalizationManager;
    if (manager?.m_strLocale) hints.push(manager.m_strLocale);
    if (manager?.m_code) hints.push(manager.m_code);
    if (document.documentElement.lang) hints.push(document.documentElement.lang);
  }
  if (typeof navigator !== "undefined") {
    hints.push(navigator.language);
    hints.push(...navigator.languages);
  }
  return hints;
}

export function detectLocale(): Locale {
  const blob = languageHints().join(" ").toLowerCase();
  if (/(schinese|tchinese|(^|[^a-z])zh([^a-z]|$))/.test(blob)) return "zh-cn";
  if (/(japanese|(^|[^a-z])ja([^a-z]|$))/.test(blob)) return "ja";
  if (/(koreana|korean|(^|[^a-z])ko([^a-z]|$))/.test(blob)) return "ko";
  if (/(portuguese|brazilian|(^|[^a-z])pt([^a-z]|$))/.test(blob)) return "pt";
  if (/(spanish|latam|(^|[^a-z])es([^a-z]|$))/.test(blob)) return "es";
  return "en";
}

function storedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved !== null && (locales as readonly string[]).includes(saved) ? saved as Locale : null;
  } catch {
    return null;
  }
}

let current = storedLocale() ?? detectLocale();

function emit() {
  for (const listener of listeners) listener();
}

export function getLocale(): Locale {
  return current;
}

export function localeOverride(): Locale | null {
  return storedLocale();
}

export function setLocale(next: Locale) {
  try { localStorage.setItem(storageKey, next); } catch { /* private mode still switches for this session */ }
  if (next === current) return;
  current = next;
  emit();
}

export function clearLocaleOverride() {
  try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  const detected = detectLocale();
  if (detected === current) return;
  current = detected;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export function numberLocale(): string {
  const tags: Record<Locale, string> = { "zh-cn": "zh-CN", en: "en", pt: "pt-PT", es: "es-ES", ja: "ja", ko: "ko" };
  return tags[getLocale()];
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text = catalogs[getLocale()][key] ?? catalogs.en[key];
  if (!vars) return text;
  for (const [name, value] of Object.entries(vars)) text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
  return text;
}

const unnamedGame = /^游戏 (\d+)$/;

export function displayGameName(name: string, id?: string): string {
  const currentName = gameOverview(id)?.display_name;
  if (currentName?.trim()) return currentName;
  const match = unnamedGame.exec(name);
  if (match && (id === undefined || match[1] === id)) return t("game.unnamed", { id: match[1] });
  return name;
}
