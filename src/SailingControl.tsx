import { PanelSection, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import { batteryStateText, SemanticText } from "./components";
import { t, useLocale } from "./i18n";
import { changeSailing, useSailing } from "./sailing";

export function SailingControl() {
  useLocale();
  const { status, error, busy } = useSailing();
  if (!status) return <PanelSectionRow><p role="status">{error || t("sailing.loading")}</p></PanelSectionRow>;
  const upper = status.enabled ? status.upper_percent : status.native_limit_percent;
  const lower = status.lower_percent;
  const delta = status.delta_percent;
  const range = upper === null || lower === null ? t("sailing.rangeUnknown") : t("sailing.range", { lower, upper });
  let phase = t(`sailing.${status.phase}`);
  if (status.enabled && status.phase !== "paused" && status.phase !== "error") {
    if (status.supply === "battery") phase = t("sailing.unplugged");
    else if (status.phase === "charging" && status.battery_state !== "Charging") phase = t("sailing.requested");
  }
  const validRange = upper !== null && lower !== null && lower >= 20 && lower < upper;
  const canEnable = status.native_enabled === true && validRange && !error;
  return <PanelSection>
    <PanelSectionRow>
      <ToggleField label={t("sailing.title")} checked={status.enabled}
        disabled={busy || (!status.enabled && !canEnable)}
        description={t("sailing.description")}
        onChange={enabled => { void changeSailing(enabled, delta); }} />
    </PanelSectionRow>
    <PanelSectionRow><p className="pt-muted" role="status">{range} · {phase} · {batteryStateText(status.battery_state)}</p></PanelSectionRow>
    <PanelSectionRow><SliderField label={t("sailing.delta")} description={t("sailing.editOff")}
      value={delta} min={1} max={80} step={1} showValue valueSuffix={t("sailing.deltaUnit")}
      disabled={busy || status.enabled}
      onChange={value => { void changeSailing(false, Math.round(value)); }} /></PanelSectionRow>
    <PanelSectionRow><p className="pt-muted">{t("sailing.nativeUpper")}</p><p className="pt-muted">{t("sailing.sleep")}</p></PanelSectionRow>
    {!status.native_enabled && <PanelSectionRow><p className="pt-muted">{t("sailing.needNative")}</p></PanelSectionRow>}
    {upper !== null && !validRange && <PanelSectionRow><SemanticText role="warning">{t("sailing.invalidRange")}</SemanticText></PanelSectionRow>}
    {(error || status.error) && <PanelSectionRow><p role="alert"><SemanticText role="error">{error || status.error}</SemanticText></p></PanelSectionRow>}
  </PanelSection>;
}
