import { useState } from "react";
import { FaGamepad } from "react-icons/fa";

export function GameIcon({ gameId, svg = false, x = 0, y = 0 }: { gameId: string; svg?: boolean; x?: number; y?: number }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const appId = Number(gameId);
  const app = /^\d+$/.test(gameId) && Number.isSafeInteger(appId) && appId > 0 ? window.appStore?.GetAppOverviewByAppID(appId) : null;
  const source = app && (app.icon_hash || app.icon_data) ? window.appStore.GetIconURLForApp(app as Parameters<typeof window.appStore.GetIconURLForApp>[0]) : null;
  if (source && failedSource !== source) {
    return svg
      ? <image className="pt-game-icon" href={source} x={x} y={y} width="18" height="18" aria-hidden="true" onError={() => setFailedSource(source)} />
      : <img className="pt-game-icon" src={source} width="18" height="18" alt="" aria-hidden="true" onError={() => setFailedSource(source)} />;
  }
  return <FaGamepad className="pt-game-icon" x={svg ? x : undefined} y={svg ? y : undefined} size={18} aria-hidden="true" />;
}
