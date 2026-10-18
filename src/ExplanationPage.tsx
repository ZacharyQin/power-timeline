import { PowerScaleLegend } from "./components";
import { t } from "./i18n";

export function ExplanationPage() {
  return <article className="pt-help" aria-label={t("help.aria")}>
    <section><h2>{t("help.energyTitle")}</h2><p>{t("help.energy")}</p></section>
    <section><h2>{t("help.systemTitle")}</h2><p>{t("help.system")}</p></section>
    <section><h2>{t("help.processTitle")}</h2><p>{t("help.process")}</p><p>{t("help.processLegend")}</p></section>
    <section><h2>{t("help.coverageTitle")}</h2><p>{t("help.coverage")}</p><p>{t("help.sort")}</p></section>
    <section><h2>{t("help.sleepTitle")}</h2><p>{t("help.sleep")}</p></section>
    <section><h2>{t("help.colorTitle")}</h2><p>{t("help.color")}</p><div className="pt-chart-auxiliary"><PowerScaleLegend /></div></section>
    <section><h2>{t("help.recordTitle")}</h2><p>{t("help.record")}</p></section>
  </article>;
}
