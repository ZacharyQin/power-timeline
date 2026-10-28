export interface GameOverview {
  display_name?: string;
  icon_hash?: string;
  icon_data?: string;
  icon_data_format?: string;
  rt_custom_image_mtime?: number;
}

interface PresentationStore {
  GetAppOverviewByAppID(appId: number): GameOverview | null | undefined;
  GetIconURLForApp(app: GameOverview): string | null;
  GetCustomImageURLs?(app: GameOverview, suffix: string): string[];
}

export function presentationAppId(gameId: string): number | null {
  if (!/^\d+$/.test(gameId)) return null;
  const value = BigInt(gameId);
  if (value > 0n && value <= 0xffffffffn) return Number(value);
  if ((value & 0xffffffffn) !== 0x02000000n) return null;
  const shortcut = value >> 32n;
  return shortcut > 0n && shortcut <= 0xffffffffn ? Number(shortcut) : null;
}

function presentationStore(): PresentationStore | undefined {
  return typeof window === "undefined" ? undefined : window.appStore as unknown as PresentationStore | undefined;
}

export function gameOverview(gameId?: string): GameOverview | null {
  const appId = gameId === undefined ? null : presentationAppId(gameId);
  return appId === null ? null : presentationStore()?.GetAppOverviewByAppID(appId) ?? null;
}

export function gameIconSources(app: GameOverview | null, saved?: string | null, cached = false): string[] {
  const store = presentationStore();
  if (!app || !store) return saved ? [saved] : [];
  const sources = [...(store.GetCustomImageURLs?.(app, "_icon") ?? [])];
  if (saved && !cached && !sources.includes(saved)) sources.unshift(saved);
  const icon = store.GetIconURLForApp(app);
  if (icon && !sources.includes(icon)) {
    if (app.icon_data && !app.icon_hash) sources.unshift(icon);
    else sources.push(icon);
  }
  if (saved && cached && !sources.includes(saved)) sources.push(saved);
  return sources;
}

export function presentationAccountId(): string | null {
  const steamId = typeof window === "undefined" ? undefined : window.App?.m_CurrentUser?.strSteamID;
  if (!steamId || !/^\d+$/.test(steamId)) return null;
  const account = BigInt(steamId) & 0xffffffffn;
  return account > 0n ? account.toString() : null;
}
