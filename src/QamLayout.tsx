import { DialogButton, Field, Focusable, GamepadButton, PanelSectionRow, type FocusableProps, type GamepadEvent } from "@decky/ui";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type FC, type ReactNode, type RefAttributes } from "react";
import { FaCheck, FaChevronDown, FaChevronUp, FaGripVertical, FaSortAmountDown, FaUndo } from "react-icons/fa";
import { Action, Reading, SemanticText } from "./components";
import { t } from "./i18n";
import { DEFAULT_QAM_ORDER, getQamOrder, QAM_BLOCKS, saveQamOrder, subscribeQamOrder, type QamBlockId } from "./qamOrder";
import { qamSortReducer } from "./qamSort";

// Steam supports explicit self-focus; Decky's Focusable type omits this native prop.
const BlockFocus = Focusable as FC<FocusableProps & RefAttributes<HTMLDivElement> & { focusable?: boolean }>;

function consume(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault();
  event.stopPropagation();
}

export function QamLayout({ blocks, visible, onFirstFocus }: {
  blocks: Record<QamBlockId, ReactNode>;
  visible: boolean;
  onFirstFocus: (node: EventTarget | null) => void;
}) {
  const saved = useSyncExternalStore(subscribeQamOrder, getQamOrder);
  const [draft, dispatch] = useReducer(qamSortReducer, null);
  const [saveFailed, setSaveFailed] = useState(false);
  const rows = useRef(new Map<QamBlockId, HTMLDivElement>());
  const entry = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<QamBlockId | "entry" | null>(null);
  const editing = draft !== null;
  const order = draft?.order ?? saved;
  const shown = editing ? order : order.filter((id) => blocks[id] !== null);
  const focusRow = (id: QamBlockId) => {
    const row = rows.current.get(id);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const focusEntry = () => {
    entry.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    entry.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  useEffect(() => {
    if (visible) return;
    pendingFocus.current = null;
    dispatch({ type: "finish" });
    setSaveFailed(false);
  }, [visible]);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target || !visible) return;
    pendingFocus.current = null;
    if (target === "entry") focusEntry();
    else focusRow(target);
  }, [draft, visible, saveFailed]);
  const begin = () => {
    pendingFocus.current = saved[0];
    setSaveFailed(false);
    dispatch({ type: "begin", order: saved });
  };
  const activate = (id: QamBlockId) => {
    if (!draft) return;
    const target = draft.lifted?.id ?? id;
    focusRow(target);
    pendingFocus.current = target;
    dispatch({ type: "activate", id });
  };
  const move = (direction: -1 | 1) => {
    if (!draft?.lifted) return;
    pendingFocus.current = draft.lifted.id;
    dispatch({ type: "move", direction });
  };
  const cancel = () => {
    if (!draft) return;
    pendingFocus.current = draft.lifted?.id ?? "entry";
    setSaveFailed(false);
    dispatch({ type: "cancel" });
  };
  const save = () => {
    if (!draft) return;
    try {
      saveQamOrder(draft.order);
    } catch {
      if (saveFailed) focusEntry();
      else {
        pendingFocus.current = "entry";
        setSaveFailed(true);
      }
      return;
    }
    pendingFocus.current = "entry";
    setSaveFailed(false);
    dispatch({ type: "finish" });
  };
  const reset = () => {
    pendingFocus.current = DEFAULT_QAM_ORDER[0];
    setSaveFailed(false);
    dispatch({ type: "reset", order: DEFAULT_QAM_ORDER });
  };
  const direction = (id: QamBlockId, event: GamepadEvent) => {
    if (!draft) return false;
    const button = event.detail.button;
    if (button !== GamepadButton.DIR_UP && button !== GamepadButton.DIR_DOWN) {
      consume(event);
      return true;
    }
    const delta = button === GamepadButton.DIR_UP ? -1 : 1;
    const index = draft.order.indexOf(id);
    if (!draft.lifted && index === draft.order.length - 1 && delta === 1) return false;
    consume(event);
    if (draft.lifted) move(delta);
    else {
      const next = draft.order[index + delta];
      if (next) focusRow(next);
    }
    return true;
  };
  return <Focusable className={editing ? "pt-qam-layout pt-qam-sorting" : "pt-qam-layout"} flow-children="column"
    onCancel={editing ? (event) => { consume(event); cancel(); } : undefined}
    onCancelActionDescription={editing ? t(draft.lifted ? "qam.orderUndoLift" : "qam.orderCancel") : undefined}
    onSecondaryButton={editing ? (event) => { consume(event); save(); } : undefined}
    onSecondaryActionDescription={editing ? t("qam.orderSave") : undefined}
    onOptionsButton={editing ? (event) => { consume(event); reset(); } : undefined}
    onOptionsActionDescription={editing ? t("qam.orderDefault") : undefined}>
    <style>{`
      .pt-qam-layout { --pt-qam-component-gap: 8px; display: flex; flex-direction: column; gap: var(--pt-qam-component-gap); }
      .pt-qam-block-list { display: flex; flex-direction: column; gap: var(--pt-qam-component-gap); }
      .pt-qam-sort-block { display: flow-root; }
      .pt-qam-block-list:not(.pt-qam-sorting) > .pt-qam-sort-block:has(> .pt-qam-block-content:empty) { display: none; }
      /* Steam's standard Field padding uses three class selectors. */
      .pt-qam .pt-qam-layout .pt-qam-sort-block .pt-semantic-field { padding-top: 0; padding-bottom: 0; }
      .pt-qam-layout .pt-locale-row { margin-top: 0; }
      .pt-qam-sorting .pt-qam-sort-block { margin: 0; position: relative; border-radius: 4px; outline: 1px solid transparent; outline-offset: -1px; scroll-margin: 12px 0; cursor: grab; transition: opacity 120ms ease, transform 120ms ease; }
      .pt-qam-sorting .pt-qam-sort-block.gpfocus { outline-color: currentColor; }
      .pt-qam-sorting .pt-qam-sort-block[data-lifted="true"] { outline: 2px solid currentColor; outline-offset: -2px; box-shadow: 0 4px 12px color-mix(in srgb, currentColor 14%, transparent); cursor: grabbing; z-index: 1; }
      .pt-qam-sorting[data-holding="true"] .pt-qam-sort-block[data-lifted="false"] { opacity: .55; transform: scale(.97); }
      .pt-qam-sort-heading { display: flex; align-items: center; gap: 6px; padding: 8px; font-size: 12px; line-height: 18px; }
      .pt-qam-sort-label { flex: 1; min-width: 0; }
      .pt-qam-sort-position { font-variant-numeric: tabular-nums; opacity: .7; }
      .pt-qam-sort-move { display: flex; gap: 6px; padding: 0 8px 8px; }
      .pt-qam-sort-move button.DialogButton { min-width: 0; width: 36px; padding: 4px; }
      .pt-qam-sort-move button.DialogButton:last-child { width: auto; flex: 1; }
      @media (prefers-reduced-motion: reduce) { .pt-qam-sorting .pt-qam-sort-block { transition: none; transform: none !important; } }
    `}</style>
    {editing && <PanelSectionRow><Field focusable={false} label={t("qam.orderTitle")} description={t("qam.orderDescription")} padding="standard" /></PanelSectionRow>}
    <Focusable flow-children="column" data-holding={draft?.lifted !== null && editing} className={editing ? "pt-qam-block-list pt-qam-sorting" : "pt-qam-block-list"}>
      {shown.map((id, index) => {
        const lifted = draft?.lifted?.id === id;
        const label = t(QAM_BLOCKS.find((block) => block.id === id)!.label);
        return <BlockFocus key={id} data-qam-block={id} data-lifted={lifted} focusable={editing ? true : undefined} tabIndex={editing ? 0 : undefined}
          ref={(node) => { if (node) rows.current.set(id, node); else rows.current.delete(id); }}
          noFocusRing={!editing} flow-children="column" preferredFocus={index === 0}
          className={`pt-qam-sort-block${!editing && index === 0 ? " pt-qam-top" : ""}`}
          role={editing ? "button" : undefined} aria-label={editing ? t("qam.orderPosition", { label, position: index + 1, total: order.length }) : undefined} aria-pressed={editing ? lifted : undefined}
          onOKButton={editing ? (event) => { consume(event); activate(id); } : undefined}
          onOKActionDescription={editing ? t(lifted ? "qam.orderDrop" : "qam.orderLift") : undefined}
          onClick={editing ? () => activate(id) : undefined}
          onGamepadDirection={editing ? (event) => direction(id, event) : undefined}
          onGamepadFocus={(event) => {
            if (editing) {
              if (draft.lifted && draft.lifted.id !== id) focusRow(draft.lifted.id);
              else if (event.target !== event.currentTarget) focusRow(id);
            } else if (index === 0) onFirstFocus(event.currentTarget);
          }}>
          {editing && <div className="pt-qam-sort-heading"><FaGripVertical aria-hidden="true" /><span className="pt-qam-sort-label">{label}{lifted && <> · {t("qam.orderLifted")}</>}</span><span className="pt-qam-sort-position">{index + 1}/{order.length}</span></div>}
          <div className="pt-qam-block-content" inert={editing} aria-hidden={editing ? true : undefined}>
            {blocks[id] ?? (editing ? <Reading label={t("qam.orderHidden")} /> : null)}
          </div>
          {lifted && <Focusable className="pt-qam-sort-move" flow-children="row">
            <DialogButton focusable={false} aria-label={t("qam.orderUp", { label })} disabled={index === 0} onClick={() => move(-1)}><FaChevronUp aria-hidden="true" /></DialogButton>
            <DialogButton focusable={false} aria-label={t("qam.orderDown", { label })} disabled={index === order.length - 1} onClick={() => move(1)}><FaChevronDown aria-hidden="true" /></DialogButton>
            <DialogButton focusable={false} onClick={() => activate(id)}>{t("qam.orderDrop")}</DialogButton>
          </Focusable>}
        </BlockFocus>;
      })}
    </Focusable>
    <div ref={entry}>
      {saveFailed && <div role="alert"><Reading label={<SemanticText role="error">{t("qam.orderSaveFailed")}</SemanticText>} /></div>}
      <Action icon={editing ? FaCheck : FaSortAmountDown} onClick={editing ? save : begin}>{t(editing ? "qam.orderSave" : "qam.orderTitle")}</Action>
    </div>
    {editing && <>
      <Action onClick={cancel}>{t(draft.lifted ? "qam.orderUndoLift" : "qam.orderCancel")}</Action>
      <Action icon={FaUndo} onClick={reset}>{t("qam.orderDefault")}</Action>
    </>}
  </Focusable>;
}
