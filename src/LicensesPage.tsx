import { Field, Navigation, PanelSectionRow } from "@decky/ui";
import { useMemo } from "react";
import { FaChevronRight, FaFileAlt } from "react-icons/fa";
import { getOpenSourceNotices } from "./backend";
import { PageQueryStatus, PageReading } from "./FullPage";
import { useQuery } from "./data";
import { t } from "./i18n";
import { updateView, useView } from "./viewState";
import type { LicenseEntry } from "./types";

const groups = ["project", "bundled", "icons", "host", "artwork"] as const;
const noteKeys = { rebuild: "licenses.rebuildNote", "font-awesome": "licenses.fontAwesomeNote", artwork: "licenses.artworkNote" } as const;

function LicenseRow({ id, title, description, onClick }: { id: string; title: string; description?: string; onClick: () => void }) {
  const view = useView();
  return <PanelSectionRow><Field className="pt-license-row" label={title} description={description}
    icon={<FaFileAlt aria-hidden="true" focusable="false" />} bottomSeparator="none"
    focusable highlightOnFocus preferredFocus={view.focus === id} childrenContainerWidth="min"
    onGamepadFocus={() => { if (view.focus !== id) updateView({ focus: id }); }}
    onOKActionDescription={title} onActivate={onClick} onClick={onClick}>
    <FaChevronRight className="pt-license-chevron" aria-hidden="true" focusable="false" />
  </Field></PanelSectionRow>;
}

export function SettingsPage() {
  const view = useView();
  return <LicenseRow id="licenses" title={t("page.licenses")} description={t("licenses.offline")}
    onClick={() => updateView({ page: "licenses", focus: view.focusByPage.licenses })} />;
}

// Bound focus nodes without changing or translating the original document text.
function textChunks(text: string) {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 600, text.length);
    if (end < text.length) {
      const space = Math.max(text.lastIndexOf(" ", end), text.lastIndexOf("\n", end));
      if (space > start) end = space + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function LicenseDocument({ title, text, component }: { title: string; text: string; component: string }) {
  const view = useView();
  const chunks = useMemo(() => textChunks(text), [text]);
  return <section className="pt-license-reader">
    <h2 className="pt-section-title">{component} · {title}</h2>
    <div className="pt-license-text" aria-label={t("licenses.fullText")}>
      {chunks.map((chunk, index) => <Field key={index} className="pt-license-paragraph"
        label={<span className="pt-license-paragraph-text">{chunk}</span>} focusable highlightOnFocus={false}
        bottomSeparator="none" preferredFocus={view.focus === `license-paragraph-${index}`}
        onGamepadFocus={() => { const focus = `license-paragraph-${index}`; if (view.focus !== focus) updateView({ focus }); }} />)}
    </div>
  </section>;
}

function LicenseContent({ entries }: { entries: LicenseEntry[] }) {
  const view = useView();
  const entry = entries.find(item => item.id === view.licenses.entry);
  if (view.licenses.entry && !entry) return <p role="alert">{t("licenses.missing")}</p>;
  if (entry) {
    const selected = view.licenses.document;
    const document = selected === null ? null : entry.documents[selected];
    if (selected !== null && !document) return <p role="alert">{t("licenses.missing")}</p>;
    if (document) return <LicenseDocument title={document.title} text={document.text} component={entry.name} />;
    return <section className="pt-license-details">
      <h2 className="pt-section-title">{entry.name}</h2>
      <PageReading label={t("licenses.license")}>{entry.license}</PageReading>
      <PageReading label={t(entry.host && entry.version ? "licenses.apiVersion" : "licenses.version")}>{entry.version ?? t("licenses.hostVersion")}</PageReading>
      {entry.host && entry.version && <p className="pt-muted">{t("licenses.hostVersion")}</p>}
      <PageReading label={t("licenses.attribution")} layout="below"><span style={{ whiteSpace: "pre-wrap" }}>{entry.attribution}</span></PageReading>
      {entry.note && <p className="pt-muted">{t(noteKeys[entry.note])}</p>}
      <LicenseRow id="license-source" title={t("licenses.source")} description={entry.source}
        onClick={() => Navigation.NavigateToExternalWeb(entry.source)} />
      <h2 className="pt-section-title">{t("licenses.documents")}</h2>
      {entry.documents.map((doc, index) => <LicenseRow key={index} id={`license-document-${index}`} title={doc.title}
        description={t("licenses.read")} onClick={() => updateView({ licenses: { ...view.licenses, document: index }, focus: "license-paragraph-0" })} />)}
    </section>;
  }
  return <div className="pt-license-list">{groups.map(group => {
    const items = entries.filter(item => item.group === group);
    if (!items.length) return null;
    return <section key={group} aria-label={t(`licenses.${group}`)}>
      <h2 className="pt-section-title">{t(`licenses.${group}`)}</h2>
      {items.map(item => <LicenseRow key={item.id} id={`license-entry-${item.id}`} title={item.name}
        description={`${item.license} · ${item.host ? t("licenses.hostVersion") : item.version ?? ""}`}
        onClick={() => updateView({ licenses: { entry: item.id, document: null }, focus: "license-document-0" })} />)}
    </section>;
  })}</div>;
}

export function LicensesPage() {
  const query = useQuery("open-source-notices", getOpenSourceNotices, true, 0);
  return <div className="pt-licenses">
    <style>{`
      .pt-licenses { min-width: 0; }
      .pt-license-list > section { margin-bottom: 16px; }
      .pt-licenses .pt-section-title { margin-top: 16px; margin-bottom: 8px; }
      .pt-licenses .pt-license-paragraph { min-height: 0; padding: 0; margin: 0; border: 0; background: none; }
      .pt-license-paragraph-text { display: block; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; text-transform: none; }
      .pt-license-details .pt-reading-value { min-width: 0; overflow-wrap: anywhere; }
    `}</style>
    <PageQueryStatus loading={query.loading && !query.data} error={query.error} retry={query.refresh} />
    {query.data && <LicenseContent entries={query.data.entries} />}
  </div>;
}
