import { useSyncExternalStore } from 'react';

export type ProgressSnapshot = {
  itemId: string;
  position: number;
  duration: number;
  buffered: number;
  playing: boolean;
  /** The feed is being swiped between pages. */
  scrolling: boolean;
};

const EMPTY: ProgressSnapshot = {
  itemId: '',
  position: 0,
  duration: 0,
  buffered: 0,
  playing: false,
  scrolling: false,
};

/**
 * Progress lives outside React state, so four events a second re-render the scrubber only,
 * never the feed or the overlays.
 */
export function createProgressStore() {
  let snapshot = EMPTY;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    set(next: Partial<ProgressSnapshot>) {
      snapshot = { ...snapshot, ...next };
      emit();
    },
    reset(itemId: string) {
      snapshot = { ...EMPTY, itemId, scrolling: snapshot.scrolling };
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => snapshot,
  };
}

export type ProgressStore = ReturnType<typeof createProgressStore>;

export function useProgressSnapshot(store: ProgressStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
