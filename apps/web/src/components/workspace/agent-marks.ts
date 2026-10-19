import { useSyncExternalStore } from 'react';
import { useWorkspace } from './context';
import type { AgentMark } from './store';

const NONE: ReadonlyMap<string, AgentMark> = new Map();

/** What an agent just did to this entity, if anything (for its halo or flash). */
export function useAgentMark(id: string | undefined): AgentMark | undefined {
  const { store } = useWorkspace();
  return useSyncExternalStore(
    store.subscribe,
    () => (id ? store.getState().agentMarks.get(id) : undefined),
    () => undefined,
  );
}

export function useAgentMarks(): ReadonlyMap<string, AgentMark> {
  const { store } = useWorkspace();
  return useSyncExternalStore(store.subscribe, () => store.getState().agentMarks, () => NONE);
}

/** The props that light an element up: data-agent="new|edit" and the agent's name. */
export function agentProps(mark: AgentMark | undefined): { 'data-agent'?: 'new' | 'edit'; 'data-agent-at'?: number } {
  return mark ? { 'data-agent': mark.fresh ? 'new' : 'edit', 'data-agent-at': mark.at } : {};
}

export function useAgentSeen(): boolean {
  const { store } = useWorkspace();
  return useSyncExternalStore(store.subscribe, () => store.getState().agentSeen, () => false);
}
