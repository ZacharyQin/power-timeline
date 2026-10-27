import { DialogButtonSecondary, Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { FaExclamationTriangle, FaSyncAlt } from "react-icons/fa";
import { IconLabel, SemanticText } from "./components";
import { t } from "./i18n";

export function PageReading({ label, children, description, className = "", layout = "inline" }: {
  label: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  className?: string;
  layout?: "inline" | "below";
}) {
  return <div className={`pt-reading pt-reading-${layout} ${className}`}>
    <span className="pt-reading-label">{label}</span>
    {children !== undefined && <div className="pt-reading-value">{children}</div>}
    {description && <div className="pt-reading-description">{description}</div>}
  </div>;
}

export function PageQueryStatus({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return <>{loading && <p className="pt-muted" role="status"><IconLabel icon={FaSyncAlt}>{t("common.loading")}</IconLabel></p>}
    {error && <div className="pt-query-error" role="alert">
      <div><SemanticText role="error"><IconLabel icon={FaExclamationTriangle}>{t("common.queryFailed")}</IconLabel></SemanticText><p>{error}</p><small>{t("common.staleShown")}</small></div>
      <Focusable><DialogButtonSecondary className="pt-compact-button" onClick={retry}>{t("common.retry")}</DialogButtonSecondary></Focusable>
    </div>}</>;
}

export function FullPageStyles() {
  return <style>{`
    .pt-fullpage { container: pt-page / inline-size; --pt-border: color-mix(in srgb, currentColor 18%, transparent); --pt-surface: color-mix(in srgb, currentColor 5%, transparent); }
    .pt-fullpage .pt-page-frame { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; }
    .pt-fullpage .pt-page-main { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; min-height: 0; }
    .pt-fullpage .pt-page-scroll { flex: 1 1 0; min-width: 0; min-height: 0; overflow-y: auto; }
    .pt-fullpage .pt-page-content { box-sizing: border-box; padding: 0 20px 16px; }
    .pt-fullpage .pt-license-row { min-width: 0; overflow-wrap: anywhere; align-items: center; }
    .pt-fullpage .pt-license-chevron { display: block; }
    .pt-fullpage .pt-page-nav { box-sizing: border-box; width: 148px; flex: 0 0 148px; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 0 12px; border-right: 1px solid var(--pt-border); }
    .pt-fullpage .pt-page-nav > * { min-width: 0; }
    .pt-fullpage .pt-page-nav-title { margin: 0 0 12px; font-size: 12px; line-height: 18px; font-weight: 650; }
    .pt-fullpage .pt-page-frame button.pt-compact-button.DialogButton { box-sizing: border-box; width: auto; min-width: 0; min-height: 32px; padding: 6px 10px; font-size: 13px; line-height: 20px; }
    .pt-fullpage .pt-page-frame .pt-page-nav button.pt-compact-button.DialogButton { width: 100%; min-height: 36px; padding: 8px; justify-content: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere; }
    .pt-fullpage .pt-page-nav .pt-nav-current:not(.gpfocus):not(:focus-visible) { background: color-mix(in srgb, currentColor 14%, transparent); box-shadow: inset 2px 0 0 currentColor; }
    .pt-fullpage .pt-page-header { box-sizing: border-box; display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; min-height: 48px; padding: 0 20px 12px; }
    .pt-fullpage .pt-page-heading { margin: 0; font-size: 18px; line-height: 24px; font-weight: 600; }
    .pt-fullpage .pt-header-actions, .pt-fullpage .pt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
    .pt-fullpage .pt-toolbar { margin-bottom: 8px; }
    .pt-fullpage .pt-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .pt-fullpage .pt-control > span { font-size: 13px; line-height: 18px; }
    .pt-fullpage .pt-control > [role="combobox"] { width: auto; min-width: 0; max-width: 100%; min-height: 32px; box-sizing: border-box; font-size: 13px; }
    .pt-fullpage .pt-control .DialogDropDown_CurrentDisplay { white-space: normal; overflow-wrap: anywhere; }
    .pt-fullpage .pt-chart-cursor:not(.gpfocus):not(.gpfocuswithin):not(:focus-within) { background: transparent; }
    .pt-fullpage .pt-chart-panel { min-width: 0; padding: 10px; border: 1px solid var(--pt-border); border-radius: 6px; background: var(--pt-surface); }
    .pt-fullpage .pt-muted { font-size: 13px; line-height: 20px; font-weight: 400; opacity: .78; margin: 8px 0; overflow-wrap: anywhere; }
    .pt-fullpage .pt-section-title { margin: 0 0 12px; font-size: 16px; line-height: 22px; font-weight: 600; }
    .pt-fullpage .pt-inline-facts { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 24px; font-size: 14px; line-height: 22px; }
    .pt-fullpage .pt-reading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin: 12px 0; min-width: 0; }
    .pt-fullpage .pt-reading-label { font-size: 14px; line-height: 20px; }
    .pt-fullpage .pt-reading-value { font-size: 16px; line-height: 24px; font-variant-numeric: tabular-nums; min-width: 0; }
    .pt-fullpage .pt-reading-inline .pt-reading-value { margin-left: auto; }
    .pt-fullpage .pt-reading-below { display: block; }
    .pt-fullpage .pt-reading-below > .pt-reading-label, .pt-fullpage .pt-reading-below > .pt-reading-value { display: block; max-width: 100%; }
    .pt-fullpage .pt-reading-below > .pt-reading-value, .pt-fullpage .pt-reading-below > .pt-reading-description { margin-top: 4px; }
    .pt-fullpage .pt-reading-description { flex-basis: 100%; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
    .pt-fullpage .pt-chart-readout { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 20px; font-size: 16px; line-height: 24px; font-variant-numeric: tabular-nums; margin: 8px 0; }
    .pt-fullpage .pt-chart-auxiliary { display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 18px; margin: 12px 0; }
    .pt-fullpage .pt-chart-auxiliary > *, .pt-fullpage .pt-power-scale { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
    .pt-fullpage .pt-power-scale { font-size: 13px; line-height: 18px; }
    .pt-fullpage .pt-badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid var(--pt-border); border-radius: 4px; font-size: 12px; line-height: 18px; font-weight: 400; }
    .pt-fullpage .pt-query-error { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px 0; }
    .pt-fullpage .pt-query-error p { margin: 4px 0; overflow-wrap: anywhere; }
    .pt-fullpage .pt-data-status { margin: 12px 0; font-size: 13px; line-height: 20px; }
    .pt-fullpage .pt-data-status-body { margin-top: 8px; padding-left: 12px; border-left: 1px solid var(--pt-border); }
    .pt-fullpage .pt-data-status-body p { margin: 8px 0; overflow-wrap: anywhere; }
    .pt-fullpage .pt-page-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; border-top: 1px solid var(--pt-border); margin-top: 24px; padding-top: 8px; font-size: 13px; line-height: 20px; }
    .pt-fullpage .pt-footer-link:not(.gpfocus):not(:focus-visible) { background: transparent; box-shadow: none; }
    .pt-fullpage .pt-help { max-width: 880px; }
    .pt-fullpage .pt-help section { padding: 16px 0; border-bottom: 1px solid var(--pt-border); }
    .pt-fullpage .pt-help p { margin: 8px 0 0; font-size: 15px; line-height: 24px; }
    .pt-fullpage .pt-help h2 { margin: 0; font-size: 17px; line-height: 24px; }
    @container pt-page (max-width: 719px) {
      .pt-fullpage .pt-page-content { padding: 0 16px 16px; }
      .pt-fullpage .pt-page-header { padding-left: 16px; padding-right: 16px; }
      .pt-fullpage .pt-page-frame { flex-direction: column; }
      .pt-fullpage .pt-page-nav { width: auto; flex: 0 0 auto; flex-direction: row; flex-wrap: wrap; border-right: 0; border-bottom: 1px solid var(--pt-border); padding: 0 16px 8px; margin-bottom: 12px; }
      .pt-fullpage .pt-page-nav-title { flex-basis: 100%; margin-bottom: 0; }
      .pt-fullpage .pt-page-frame .pt-page-nav button.pt-compact-button.DialogButton { width: auto; }
      .pt-fullpage .pt-page-nav .pt-nav-current:not(.gpfocus):not(:focus-visible) { box-shadow: inset 0 -2px 0 currentColor; }
    }
  `}</style>;
}
