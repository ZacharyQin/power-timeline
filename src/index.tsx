import { addEventListener, definePlugin, removeEventListener, routerHook } from "@decky/api";
import { DialogBody, DialogButtonSecondary, DialogHeader, findModuleExport, Focusable, NavEntryPositionPreferences, Navigation, staticClasses } from "@decky/ui";
import { useEffect, useRef } from "react";
import { FaBatteryHalf, FaChartLine, FaChevronLeft, FaGamepad, FaHistory, FaInfoCircle, FaListUl, FaProjectDiagram } from "react-icons/fa";
import { BatteryTimeline } from "./BatteryTimeline";
import { IconLabel, SemanticStyles, SemanticText, valueText } from "./components";
import { receiveSnapshot, useDocumentVisible, useSnapshot } from "./data";
import { GameHistory } from "./GameHistory";
import { ExplanationPage } from "./ExplanationPage";
import { FullPageStyles, PageQueryStatus } from "./FullPage";
import { QamSummary } from "./QamSummary";
import { LocaleFlags } from "./LocaleFlags";
import { PowerInfoPage } from "./PowerInfoPage";
import { PowerFlowPage } from "./PowerFlowPage";
import { SessionDetail } from "./SessionDetail";
import type { Snapshot } from "./types";
import { backPage, openHelp, updateView, useView } from "./viewState";
import { t, useLocale } from "./i18n";

// DialogBody only supplies layout; a routed page must own its native composition request.
const useNativeComposition = findModuleExport((value) => {
  const source = typeof value === "function" ? value.toString() : "";
  return source.includes(".AddMinimumCompositionStateRequest(") && source.includes(".RemoveMinimumCompositionStateRequest(") && source.includes(".useEffect(");
}) as (mode: number, source: string) => unknown;
const OPAQUE_COMPOSITION = 3;
const pageKey = { timeline: "page.timeline", power: "page.power", flow: "page.flow", games: "page.games", sessions: "page.sessions", detail: "page.detail", help: "page.help" } as const;

function scrollFocusedIntoView(scroller: HTMLElement, target: Element) {
  const node = target instanceof HTMLElement ? target : target.parentElement;
  if (!node || !scroller.contains(node)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = node.getBoundingClientRect();
  const topGap = targetRect.top - scrollerRect.top;
  const bottomGap = targetRect.bottom - scrollerRect.bottom;
  if (targetRect.height >= scrollerRect.height - 24) {
    if (topGap < 12) scroller.scrollTop += topGap - 12;
    return;
  }
  if (topGap < 12) scroller.scrollTop += topGap - 12;
  else if (bottomGap > -12) scroller.scrollTop += bottomGap + 12;
}

function PowerTimelinePage() {
  useLocale();
  useNativeComposition(OPAQUE_COMPOSITION, "Power Timeline");
  const scrollRef = useRef<HTMLDivElement>(null);
  const view = useView();
  const visible = useDocumentVisible();
  const summary = useSnapshot(visible);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onFocus = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) scrollFocusedIntoView(scroller, target);
    };
    scroller.addEventListener("focusin", onFocus);
    scroller.addEventListener("vgp_onfocus", onFocus);
    return () => {
      scroller.removeEventListener("focusin", onFocus);
      scroller.removeEventListener("vgp_onfocus", onFocus);
    };
  }, [view.page]);
  const back = () => {
    if (view.page === "timeline" || view.page === "power" || view.page === "flow") Navigation.NavigateBack();
    else backPage();
  };
  const backLabel = view.page === "help" ? t(pageKey[view.helpOrigin]) : view.page === "detail" ? (view.detailOrigin === "timeline" ? t("page.timeline") : t("page.sessions")) : view.page === "sessions" ? t("page.groups") : view.page === "games" ? t("page.timeline") : t("common.steam");
  const pageIcon = view.page === "timeline" ? FaChartLine : view.page === "power" ? FaBatteryHalf : view.page === "flow" ? FaProjectDiagram : view.page === "games" ? FaGamepad : view.page === "sessions" ? FaHistory : view.page === "help" ? FaInfoCircle : FaListUl;
  return <DialogBody className={`pt-fullpage${view.page === "power" ? " pt-power-page" : ""}`} style={{ height: "100%", boxSizing: "border-box", padding: "52px 0" }}>
    <SemanticStyles /><FullPageStyles />
    <Focusable key={view.page} ref={scrollRef} autoFocus flow-children="column" className="pt-page-scroll" navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD} onCancel={(event) => {
      event.preventDefault();
      event.stopPropagation();
      back();
    }} onCancelActionDescription={t("nav.cancel", { label: backLabel })}>
      <div className="pt-page-content">
          <Focusable className="pt-page-header" flow-children="row">
            <DialogHeader className="pt-page-heading" style={{ marginBottom: 0, fontSize: 20, lineHeight: "28px" }}><IconLabel icon={pageIcon}>{t("common.product")} · {t(pageKey[view.page])}</IconLabel></DialogHeader>
            <Focusable className="pt-header-actions" flow-children="row">
              {view.page === "timeline" && <Focusable preferredFocus={view.focus === "games"}><DialogButtonSecondary className="pt-compact-button" onClick={() => updateView({ page: "games", live: false, focus: view.gameId ? `game:${view.gameId}` : "history" })}><IconLabel icon={FaGamepad}>{t("nav.games")}</IconLabel></DialogButtonSecondary></Focusable>}
              <Focusable preferredFocus={view.focus === "back"}><DialogButtonSecondary className="pt-compact-button" onClick={back}><IconLabel icon={FaChevronLeft}>{t("nav.back", { label: backLabel })}</IconLabel></DialogButtonSecondary></Focusable>
            </Focusable>
          </Focusable>
          <PageQueryStatus loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
          {summary.snapshot && summary.snapshot.status !== "recording" && <div className="pt-query-error" role="alert"><SemanticText role={summary.snapshot.status === "error" ? "error" : "warning"}>{summary.snapshot.status === "error" ? t("common.recordError") : t("common.recordStopped")} · {summary.snapshot.error ?? t("common.backendIdle")}</SemanticText></div>}
          {summary.snapshot?.sample && Date.now() / 1000 - summary.snapshot.sample.timestamp > 10 && <p className="pt-muted"><SemanticText role="warning">{t("common.sampleStale")}</SemanticText></p>}
          {view.page === "timeline" && <BatteryTimeline visible={visible} />}
          {view.page === "power" && <PowerInfoPage visible={visible} />}
          {view.page === "flow" && <PowerFlowPage flow={summary.snapshot?.power_flow ?? null} visible={visible} />}
          {(view.page === "games" || view.page === "sessions") && <GameHistory visible={visible} />}
          {view.page === "detail" && <SessionDetail visible={visible} />}
          {view.page === "help" && <ExplanationPage />}
          <footer className="pt-page-footer">
            <span className="pt-muted">{summary.snapshot ? <>{summary.snapshot.status === "recording" ? t("common.recording") : t("common.notRecording")} · {t("common.storage", { used: valueText(summary.snapshot.storage_bytes / 1048576, "MiB", 1), limit: valueText(summary.snapshot.storage_limit_bytes / 1048576, "MiB", 1) })}</> : t("common.readingBackend")}</span>
            {view.page !== "help" && <Focusable preferredFocus={view.focus === "help"}><DialogButtonSecondary className="pt-compact-button pt-footer-link" onClick={openHelp}>{t("common.helpLink")}</DialogButtonSecondary></Focusable>}
          </footer>
          <LocaleFlags />
      </div>
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
