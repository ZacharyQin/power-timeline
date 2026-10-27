import { DialogButtonSecondary, Dropdown, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import type { CSSProperties } from "react";
import { FaCalendarAlt, FaChevronLeft, FaChevronRight, FaSortAmountDown } from "react-icons/fa";
import { getGameHistory } from "./backend";
import { GameIcon } from "./GameIcon";
import { IconLabel, PowerScaleLegend, SemanticText, energyFields, metricIcons, metricLabel, metricOrder, sessionLabel, sortLabel, sortOrder, timeText, valueText } from "./components";
import { displayGameName, t } from "./i18n";
import { useQuery } from "./data";
import { getPowerBand, semanticColors } from "./displaySemantics";
import { PageQueryStatus } from "./FullPage";
import type { Metric, Sort } from "./types";
import { openSession, updateView, useView } from "./viewState";

function HistoryValue({ value, powerSorted, metric }: { value: number | null; powerSorted: boolean; metric: Metric }) {
  const color = value === null ? undefined : powerSorted ? getPowerBand(value)?.color : semanticColors[metric === "system" ? "system" : "process"];
  return <strong className="pt-history-value"><span className={color ? "pt-color" : undefined} style={color ? { "--pt-color": color } as CSSProperties : undefined}>{valueText(value, "").trimEnd()}</span></strong>;
}

export function GameHistory({ visible }: { visible: boolean }) {
  const view = useView();
  const sessions = view.page === "sessions";
  const offset = sessions ? view.sessionsOffset : view.gamesOffset;
  const limit = 25;
  const powerSorted = view.sort === "power";
  const query = useQuery(`history:${sessions ? view.gameId : "all"}:${view.metric}:${view.sort}:${offset}`, () => getGameHistory(sessions ? view.gameId : null, null, null, view.metric, view.sort, offset, limit), visible);
  const data = query.data;
  return <Focusable className="pt-history" flow-children="column" navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}>
    <style>{`
      .pt-fullpage .pt-history { display: flex; flex-direction: column; gap: 12px; container-type: inline-size; }
      .pt-fullpage .pt-history-heading { margin: 0; font-size: 16px; line-height: 22px; }
      .pt-fullpage .pt-history-summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; font-size: 13px; line-height: 18px; }
      .pt-fullpage .pt-history-list { background: color-mix(in srgb, currentColor 4%, transparent); }
      .pt-fullpage .pt-history-row {
        display: grid; grid-template-columns: 20px minmax(0, 1fr) 112px 16px; align-items: center; gap: 12px;
        box-sizing: border-box; width: 100%; min-width: 0; min-height: 72px; height: auto; margin: 0;
        padding: 12px 16px; border: 0; border-radius: 0; text-align: left;
        white-space: normal; font-size: 16px; line-height: 22px; opacity: 1;
      }
      .pt-fullpage .pt-history-row + .pt-history-row { border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
      .pt-fullpage .pt-history-row:not(.gpfocus):not(.gpfocuswithin):not(:focus-visible):not(:focus-within):not(:hover):not(:active) { background: transparent; box-shadow: none; }
      .pt-fullpage .pt-history-session { min-height: 80px; }
      .pt-fullpage .pt-history-copy { min-width: 0; }
      .pt-fullpage .pt-history-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; font-weight: 500; overflow-wrap: anywhere; }
      .pt-fullpage .pt-history-meta { display: block; margin-top: 4px; font-size: 13px; line-height: 18px; opacity: .78; }
      .pt-fullpage .pt-history-tag { display: inline-block; font-size: 13px; line-height: 18px; font-weight: 400; }
      .pt-fullpage .pt-history-value { min-width: 0; text-align: right; font-size: 18px; line-height: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .pt-fullpage .pt-history-chevron { width: 16px; height: 16px; }
      .pt-fullpage .pt-history-row:is(.gpfocus, .gpfocuswithin, :focus-visible, :focus-within, :active) .pt-color { color: inherit; }
      .pt-fullpage .pt-history-row:is(.gpfocus, .gpfocuswithin, :focus-visible, :focus-within) .pt-history-meta { opacity: 1; }
      .pt-fullpage .pt-history-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
      .pt-fullpage .pt-history-count { margin-right: auto; font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; }
      @container (max-width: 700px) {
        .pt-fullpage .pt-history-row { grid-template-columns: 20px minmax(0, 1fr) 104px 16px; gap: 8px; padding-inline: 12px; }
        .pt-fullpage .pt-history-session { min-height: 88px; }
      }
    `}</style>
    <h2 className="pt-history-heading">{sessions ? t("history.sessions", { name: displayGameName(view.gameName, view.gameId ?? undefined) }) : t("history.title")}</h2>
    <Focusable className="pt-toolbar" flow-children="row" navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}>
      <Focusable className="pt-control" preferredFocus={view.focus === "history"} onGamepadFocus={() => updateView({ focus: "history" })}>
        <span className="pt-muted">{t("history.metric")}</span>
        <Dropdown aria-label={t("history.metric")} menuLabel={t("history.metric")} selectedOption={view.metric} rgOptions={metricOrder.map((data) => ({ data, label: <IconLabel icon={metricIcons[data]}>{metricLabel(data)}</IconLabel> }))} onChange={(option) => updateView({ metric: option.data as Metric, gamesOffset: 0, sessionsOffset: 0, focus: "history" })} />
      </Focusable>
      <Focusable className="pt-control" preferredFocus={view.focus === "sort"} onGamepadFocus={() => updateView({ focus: "sort" })}>
        <span className="pt-muted"><IconLabel icon={FaSortAmountDown}>{t("history.sort")}</IconLabel></span>
        <Dropdown aria-label={t("history.sort")} menuLabel={t("history.sort")} selectedOption={view.sort} rgOptions={sortOrder.map((data) => ({ data, label: sortLabel(data) }))} onChange={(option) => updateView({ sort: option.data as Sort, gamesOffset: 0, sessionsOffset: 0, focus: "sort" })} />
      </Focusable>
    </Focusable>
    <div className="pt-history-summary">
      <span className="pt-muted">{t("history.scope")}</span>
      <span id="pt-history-metric">{metricLabel(view.metric)} · {powerSorted ? t("history.powerUnit") : t("history.energyUnit")}</span>
    </div>
    <PageQueryStatus loading={query.loading} error={query.error} retry={query.refresh} />
    {data && (sessions ? data.sessions.length === 0 : data.games.length === 0) && <div className="pt-muted">{t("history.empty")}</div>}
    {data && (sessions ? data.sessions.length > 0 : data.games.length > 0) && <Focusable className="pt-history-list" flow-children="column" role="group" aria-labelledby="pt-history-metric" preferredFocus={view.focus.startsWith(sessions ? "session:" : "game:")} navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}>
      {!sessions && data.games.map((game) => {
        const identity = `game:${game.game_id}`;
        const open = () => {
          updateView({ focus: identity });
          updateView({ page: "sessions", gameId: game.game_id, gameName: game.name, sessionsOffset: view.gameId === game.game_id ? view.sessionsOffset : 0, focus: view.gameId === game.game_id && view.sessionId ? `session:${view.sessionId}` : "history" });
        };
        const reading = powerSorted ? game.average_w : game[energyFields[view.metric]];
        return <DialogButtonSecondary key={game.game_id} className="pt-history-row" preferredFocus={view.focus === identity} onGamepadFocus={() => updateView({ focus: identity })} onClick={open} onOKActionDescription={t("history.openSessions")}>
          <GameIcon gameId={game.game_id} />
          <span className="pt-history-copy"><span className="pt-history-title">{displayGameName(game.name, game.game_id)}</span><span className="pt-history-meta">{t("history.meta", { count: game.session_count, time: timeText(game.last_seen, true) })}</span></span>
          <HistoryValue value={reading} powerSorted={powerSorted} metric={view.metric} />
          <FaChevronRight className="pt-history-chevron" aria-hidden="true" />
        </DialogButtonSecondary>;
      })}
      {sessions && data.sessions.map((session) => {
        const identity = `session:${session.session_id}`;
        const open = () => {
          updateView({ focus: identity });
          openSession(session.session_id, "sessions");
        };
        const reading = powerSorted ? session.average_w : session[energyFields[view.metric]];
        return <DialogButtonSecondary key={session.session_id} className="pt-history-row pt-history-session" preferredFocus={view.focus === identity} onGamepadFocus={() => updateView({ focus: identity })} onClick={open} onOKActionDescription={t("history.openDetail")}>
          <FaCalendarAlt aria-hidden="true" />
          <span className="pt-history-copy">
            <span className="pt-history-title"><span>{timeText(session.started_at, true)}</span><span className="pt-history-tag">{session.status === "interrupted" ? <SemanticText role="warning">{sessionLabel(session.status)}</SemanticText> : sessionLabel(session.status)}</span>{session.partial_start && <span className="pt-history-tag">{t("session.partialShort")}</span>}</span>
            <span className="pt-history-meta">{t("history.lastSeen", { time: timeText(session.last_seen, true) })}</span>
          </span>
          <HistoryValue value={reading} powerSorted={powerSorted} metric={view.metric} />
          <FaChevronRight className="pt-history-chevron" aria-hidden="true" />
        </DialogButtonSecondary>;
      })}
    </Focusable>}
    {(data || offset > 0) && <Focusable className="pt-history-pager" flow-children="row">
      {data && <span className="pt-history-count pt-muted">{data.total === 0 ? t("history.countZero") : t("history.count", { from: offset + 1, to: Math.min(offset + limit, data.total), total: data.total })}</span>}
      {offset > 0 && <DialogButtonSecondary style={{ width: "auto" }} onClick={() => updateView(sessions ? { sessionsOffset: Math.max(0, offset - limit), focus: "history" } : { gamesOffset: Math.max(0, offset - limit), focus: "history" })}><IconLabel icon={FaChevronLeft}>{t("common.previous")}</IconLabel></DialogButtonSecondary>}
      {data && offset + limit < data.total && <DialogButtonSecondary style={{ width: "auto" }} onClick={() => updateView(sessions ? { sessionsOffset: offset + limit, focus: "history" } : { gamesOffset: offset + limit, focus: "history" })}><IconLabel icon={FaChevronRight}>{t("common.next")}</IconLabel></DialogButtonSecondary>}
    </Focusable>}
    {powerSorted && <PowerScaleLegend />}
  </Focusable>;
}
