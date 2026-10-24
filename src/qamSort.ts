import type { QamBlockId } from "./qamOrder";

export type QamSortState = {
  order: readonly QamBlockId[];
  lifted: { id: QamBlockId; origin: number } | null;
} | null;

export type QamSortAction =
  | { type: "begin"; order: readonly QamBlockId[] }
  | { type: "activate"; id: QamBlockId }
  | { type: "move"; direction: -1 | 1 }
  | { type: "reset"; order: readonly QamBlockId[] }
  | { type: "cancel" }
  | { type: "finish" };

export function qamSortReducer(state: QamSortState, action: QamSortAction): QamSortState {
  if (action.type === "begin") return { order: action.order, lifted: null };
  if (action.type === "finish" || !state) return null;
  if (action.type === "reset") return { order: action.order, lifted: null };
  if (action.type === "activate") {
    if (state.lifted) return state.lifted.id === action.id ? { ...state, lifted: null } : state;
    const origin = state.order.indexOf(action.id);
    return origin < 0 ? state : { ...state, lifted: { id: action.id, origin } };
  }
  if (action.type === "cancel") {
    if (!state.lifted) return null;
    const order = [...state.order];
    order.splice(order.indexOf(state.lifted.id), 1);
    order.splice(state.lifted.origin, 0, state.lifted.id);
    return { order, lifted: null };
  }
  if (!state.lifted) return state;
  const index = state.order.indexOf(state.lifted.id);
  const target = index + action.direction;
  if (target < 0 || target >= state.order.length) return state;
  const order = [...state.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...state, order };
}
