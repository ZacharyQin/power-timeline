import { DialogButtonSecondary, Focusable } from "@decky/ui";
import { useId, useState } from "react";
import { GameIcon } from "./GameIcon";
import type { TimelineGame } from "./timelineEvents";

const PREVIEW_SIZE = 2;
const PAGE_SIZE = 6;

export function GameLegend({ games }: { games: readonly TimelineGame[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const listId = useId();
  const lastPage = Math.max(0, Math.ceil(games.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  if (page !== currentPage) setPage(currentPage);
  if (games.length === 0) return null;
  const from = expanded ? currentPage * PAGE_SIZE : 0;
  const visible = games.slice(from, from + (expanded ? PAGE_SIZE : PREVIEW_SIZE));
  return <Focusable className="pt-game-legend" flow-children="column" aria-label="游戏区间图例">
    <style>{`
      .pt-fullpage .pt-chart-auxiliary > .pt-game-legend { display: block; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--pt-border); }
      .pt-fullpage .pt-game-legend-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 6px; }
      .pt-fullpage .pt-game-legend-heading > span { margin: 0 auto 0 0; }
      .pt-fullpage .pt-game-entries { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; }
      .pt-fullpage .pt-game-key { display: grid; grid-template-columns: 4px 18px minmax(0, 1fr); align-items: start; gap: 8px; min-width: 0; }
      .pt-fullpage .pt-game-swatch { width: 4px; height: 18px; border-radius: 2px; }
      .pt-fullpage .pt-game-key-name { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
      .pt-fullpage .pt-game-icon { object-fit: contain; flex-shrink: 0; }
      .pt-fullpage .pt-game-legend-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
      .pt-fullpage .pt-game-legend-pager > span { margin: 0 auto 0 0; }
      @container pt-page (max-width: 519px) { .pt-fullpage .pt-game-entries { grid-template-columns: minmax(0, 1fr); } }
    `}</style>
    <Focusable className="pt-game-legend-heading" flow-children="row">
      <span className="pt-muted">游戏区间 · {games.length} 款</span>
      {(games.length > PREVIEW_SIZE || expanded) && <DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls={listId} onClick={() => { setPage(0); setExpanded(!expanded); }}>
        {expanded ? "收起游戏图例" : `全部 ${games.length} 款`}
      </DialogButtonSecondary>}
    </Focusable>
    <div id={listId} className="pt-game-entries" role="list">
      {visible.map((game) => <span className="pt-game-key" role="listitem" key={game.id} data-game-id={game.id}>
        <span className="pt-game-swatch" style={{ backgroundColor: game.color }} aria-hidden="true" />
        <GameIcon gameId={game.id} />
        <span className="pt-game-key-name">{game.name}</span>
      </span>)}
    </div>
    {expanded && lastPage > 0 && <Focusable className="pt-game-legend-pager" flow-children="row">
      <span className="pt-muted" aria-live="polite">{from + 1}–{from + visible.length} / {games.length} 款 · 第 {currentPage + 1}/{lastPage + 1} 页</span>
      <DialogButtonSecondary className="pt-compact-button" disabled={currentPage === 0} aria-disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</DialogButtonSecondary>
      <DialogButtonSecondary className="pt-compact-button" disabled={currentPage === lastPage} aria-disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</DialogButtonSecondary>
    </Focusable>}
  </Focusable>;
}
