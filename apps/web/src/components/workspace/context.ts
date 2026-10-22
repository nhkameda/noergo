import { createContext, useContext } from 'react';
import type { Actions } from './actions';
import type { WorkspaceStore } from './store';

/** What every part of the workspace may call. Stable for the life of the page. */
export interface WorkspaceApi {
  store: WorkspaceStore;
  actions: Actions;
  openNote: (id: string) => void;
  /** Closes the open note without taking the focus anywhere: a click elsewhere did it. */
  dismissNote: () => void;
  showBoard: (id: string) => void;
  /** The mind map of a column, over the board (Back closes it). */
  openMap: (laneId: string) => void;
  /** Read out by screen readers (moves made with the keyboard). */
  announce: (text: string) => void;
  /** The cover and colour panel of a column, next to `anchor`; a picture given is taken as its cover. */
  customize: (laneId: string, anchor: DOMRect, file?: File) => void;
  /** Back to the columns, with this one at the start and lit up. */
  revealLane: (laneId: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext);
  if (!api) throw new Error('useWorkspace outside <Workspace>');
  return api;
}

/** Typing in a field must not trigger the board's single-key shortcuts. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Enter that confirms an IME candidate (Chinese, Japanese) is not Enter that submits. */
export function isComposing(e: { nativeEvent: KeyboardEvent } | KeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229;
}
