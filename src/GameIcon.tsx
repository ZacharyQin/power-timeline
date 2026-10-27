import { useMemo, useRef, useState } from "react";
import { FaGamepad } from "react-icons/fa";
import { getGameIcon } from "./backend";
import { useDocumentVisible, useQuery } from "./data";
import { gameIconSources, gameOverview, presentationAccountId, presentationAppId } from "./gamePresentation";

const imageStyle = { objectFit: "contain", flexShrink: 0 } as const;

export function GameIcon({ gameId, svg = false, x = 0, y = 0 }: { gameId: string; svg?: boolean; x?: number; y?: number }) {
  const app = gameOverview(gameId);
  const appId = presentationAppId(gameId);
  const accountId = presentationAccountId();
  const visible = useDocumentVisible();
  const key = `game-icon:${accountId}:${appId}`;
  const cached = useRef<{ key: string; revision: string; source: string | null } | null>(null);
  const saved = useQuery<string | null>(key, async () => {
    if (appId === null || accountId === null) return null;
    const previous = cached.current?.key === key ? cached.current : null;
    const result = await getGameIcon(String(appId), accountId, previous?.revision);
    const source = result.source === undefined ? previous?.source ?? null : result.source;
    cached.current = { key, revision: result.revision, source };
    return source;
  }, visible && appId !== null && accountId !== null);
  const sources = useMemo(() => gameIconSources(app, saved.data), [gameId, app, app?.icon_hash, app?.icon_data, app?.icon_data_format, app?.rt_custom_image_mtime, saved.data]);
  const [failure, setFailure] = useState<{ sources: string[]; index: number } | null>(null);
  const index = failure?.sources === sources ? failure.index : 0;
  const source = sources[index];
  const failed = () => setFailure({ sources, index: index + 1 });
  if (source) {
    return svg
      ? <image className="pt-game-icon" href={source} x={x} y={y} width="18" height="18" aria-hidden="true" onError={failed} />
      : <img className="pt-game-icon" src={source} width="18" height="18" style={imageStyle} alt="" aria-hidden="true" onError={failed} />;
  }
  return <FaGamepad className="pt-game-icon" x={svg ? x : undefined} y={svg ? y : undefined} size={18} aria-hidden="true" />;
}
