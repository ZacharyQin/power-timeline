import { DialogButtonSecondary, Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { FaExclamationTriangle, FaSyncAlt } from "react-icons/fa";
import { IconLabel, SemanticText } from "./components";

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
  return <>{loading && <p className="pt-muted" role="status"><IconLabel icon={FaSyncAlt}>正在读取真实记录…</IconLabel></p>}
    {error && <div className="pt-query-error" role="alert">
      <div><SemanticText role="error"><IconLabel icon={FaExclamationTriangle}>查询失败</IconLabel></SemanticText><p>{error}</p><small>已显示的旧记录不代表当前状态。</small></div>
      <Focusable><DialogButtonSecondary className="pt-compact-button" onClick={retry}>重新读取</DialogButtonSecondary></Focusable>
    </div>}</>;
}

export function FullPageStyles() {
  return <style>{`
    .pt-fullpage { container: pt-page / inline-size; --pt-border: color-mix(in srgb, currentColor 18%, transparent); --pt-surface: color-mix(in srgb, currentColor 5%, transparent); }
    .pt-fullpage .pt-page-content { box-sizing: border-box; padding: 0 24px; min-width: 0; }
    .pt-fullpage .pt-page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .pt-fullpage .pt-page-heading { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
    .pt-fullpage .pt-header-actions, .pt-fullpage .pt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
    .pt-fullpage .pt-toolbar { margin-bottom: 12px; }
    .pt-fullpage .pt-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .pt-fullpage .pt-control > span { font-size: 14px; line-height: 20px; }
    .pt-fullpage .pt-control > [role="combobox"] { width: auto; min-width: 0; max-width: 100%; min-height: 40px; box-sizing: border-box; font-size: 14px; }
    .pt-fullpage .pt-control .DialogDropDown_CurrentDisplay { white-space: normal; overflow-wrap: anywhere; }
    .pt-fullpage .pt-chart-cursor:not(.gpfocus):not(.gpfocuswithin):not(:focus-within) { background: transparent; }
    .pt-fullpage .pt-compact-button { width: auto; min-width: 0; min-height: 40px; padding: 8px 12px; font-size: 14px; line-height: 20px; }
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
    @container pt-page (max-width: 719px) { .pt-fullpage .pt-page-content { padding: 0 16px; } }
  `}</style>;
}
