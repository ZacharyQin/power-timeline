import { addEventListener, definePlugin, removeEventListener, routerHook } from "@decky/api";
import { DialogBody, DialogButtonSecondary, DialogHeader, findModuleExport, Focusable, NavEntryPositionPreferences, Navigation, ScrollPanel, staticClasses } from "@decky/ui";
import { FaBatteryHalf, FaChartLine, FaChevronLeft, FaGamepad, FaHistory, FaInfoCircle, FaListUl } from "react-icons/fa";
import { BatteryTimeline } from "./BatteryTimeline";
import { IconLabel, SemanticStyles, SemanticText, valueText } from "./components";
import { receiveSnapshot, useDocumentVisible, useSnapshot } from "./data";
import { GameHistory } from "./GameHistory";
import { ExplanationPage } from "./ExplanationPage";
import { FullPageStyles, PageQueryStatus } from "./FullPage";
import { QamSummary } from "./QamSummary";
import { PowerInfoPage } from "./PowerInfoPage";
import { SessionDetail } from "./SessionDetail";
import type { Snapshot } from "./types";
import { backPage, openHelp, updateView, useView } from "./viewState";
import type { Page } from "./viewState";

// DialogBody only supplies layout; a routed page must own its native composition request.
const useNativeComposition = findModuleExport((value) => {
  const source = typeof value === "function" ? value.toString() : "";
  return source.includes(".AddMinimumCompositionStateRequest(") && source.includes(".RemoveMinimumCompositionStateRequest(") && source.includes(".useEffect(");
}) as (mode: number, source: string) => unknown;
const OPAQUE_COMPOSITION = 3;
const pageLabels: Record<Page, string> = { timeline: "电池时间线", power: "电源与电池", games: "游戏历史", sessions: "历次会话", detail: "会话详情", help: "统计说明" };

function PowerTimelinePage() {
  useNativeComposition(OPAQUE_COMPOSITION, "Power Timeline");
  const view = useView();
  const visible = useDocumentVisible();
  const summary = useSnapshot(visible);
  const back = () => {
    if (view.page === "timeline") Navigation.NavigateBack();
    else backPage();
  };
  const backLabel = view.page === "help" ? pageLabels[view.helpOrigin] : view.page === "detail" ? (view.detailOrigin === "timeline" ? "电池时间线" : "历次会话") : view.page === "sessions" ? "游戏分组" : view.page === "games" || view.page === "power" ? "电池时间线" : "Steam";
  const pageIcon = view.page === "timeline" ? FaChartLine : view.page === "power" ? FaBatteryHalf : view.page === "games" ? FaGamepad : view.page === "sessions" ? FaHistory : view.page === "help" ? FaInfoCircle : FaListUl;
  return <DialogBody className={`pt-fullpage${view.page === "power" ? " pt-power-page" : ""}`} style={{ height: "100%", boxSizing: "border-box", padding: "52px 0" }}>
    <SemanticStyles /><FullPageStyles />
    <Focusable key={view.page} autoFocus flow-children="column" style={{ height: "100%", overflowY: "auto" }} navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD} onCancel={(event) => {
      event.preventDefault();
      event.stopPropagation();
      back();
    }} onCancelActionDescription={`返回${backLabel}`}>
      <ScrollPanel>
        <div className="pt-page-content">
          <Focusable className="pt-page-header" flow-children="row">
            <DialogHeader className="pt-page-heading" style={{ marginBottom: 0, fontSize: 20, lineHeight: "28px" }}><IconLabel icon={pageIcon}>Power Timeline · {pageLabels[view.page]}</IconLabel></DialogHeader>
            <Focusable className="pt-header-actions" flow-children="row">
              {view.page === "timeline" && <Focusable preferredFocus={view.focus === "games"}><DialogButtonSecondary className="pt-compact-button" onClick={() => updateView({ page: "games", live: false, focus: view.gameId ? `game:${view.gameId}` : "history" })}><IconLabel icon={FaGamepad}>游戏记录</IconLabel></DialogButtonSecondary></Focusable>}
              {view.page === "timeline" && <Focusable preferredFocus={view.focus === "power"}><DialogButtonSecondary className="pt-compact-button" onClick={() => updateView({ page: "power", focus: "back" })}><IconLabel icon={FaBatteryHalf}>电源与电池</IconLabel></DialogButtonSecondary></Focusable>}
              <Focusable preferredFocus={view.focus === "back"}><DialogButtonSecondary className="pt-compact-button" onClick={back}><IconLabel icon={FaChevronLeft}>返回{backLabel}</IconLabel></DialogButtonSecondary></Focusable>
            </Focusable>
          </Focusable>
          <PageQueryStatus loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
          {summary.snapshot && summary.snapshot.status !== "recording" && <div className="pt-query-error" role="alert"><SemanticText role={summary.snapshot.status === "error" ? "error" : "warning"}>{summary.snapshot.status === "error" ? "记录错误" : "记录已停止"} · {summary.snapshot.error ?? "后台未在记录，历史仍可查询。"}</SemanticText></div>}
          {summary.snapshot?.sample && Date.now() / 1000 - summary.snapshot.sample.timestamp > 10 && <p className="pt-muted"><SemanticText role="warning">当前采样已过期；历史读数不代表当前状态。</SemanticText></p>}
          {view.page === "timeline" && <BatteryTimeline visible={visible} />}
          {view.page === "power" && <PowerInfoPage visible={visible} />}
          {(view.page === "games" || view.page === "sessions") && <GameHistory visible={visible} />}
          {view.page === "detail" && <SessionDetail visible={visible} />}
          {view.page === "help" && <ExplanationPage />}
          <footer className="pt-page-footer">
            <span className="pt-muted">{summary.snapshot ? <>{summary.snapshot.status === "recording" ? "记录中" : "记录未运行"} · 存储 {valueText(summary.snapshot.storage_bytes / 1048576, "MiB", 1)} / {valueText(summary.snapshot.storage_limit_bytes / 1048576, "MiB", 1)}</> : "正在读取后台状态"}</span>
            {view.page !== "help" && <Focusable preferredFocus={view.focus === "help"}><DialogButtonSecondary className="pt-compact-button pt-footer-link" onClick={openHelp}>统计说明 ›</DialogButtonSecondary></Focusable>}
          </footer>
        </div>
      </ScrollPanel>
    </Focusable>
  </DialogBody>;
}

export default definePlugin(() => {
  routerHook.addRoute("/power-timeline", PowerTimelinePage);
  const listener = addEventListener<[snapshot: Snapshot]>("snapshot_changed", receiveSnapshot);
  return {
    name: "Power Timeline",
    titleView: <div className={staticClasses.Title}>Power Timeline</div>,
    icon: <FaBatteryHalf />,
    content: <QamSummary />,
    onDismount() {
      removeEventListener("snapshot_changed", listener);
      routerHook.removeRoute("/power-timeline");
    },
  };
});
