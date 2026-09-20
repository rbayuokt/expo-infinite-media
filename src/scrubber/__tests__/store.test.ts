import { createProgressStore } from '../store';

describe('progress store', () => {
  it('merges partial updates and notifies once each', () => {
    const store = createProgressStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);

    store.set({ itemId: 'a', position: 1, duration: 10, buffered: 3 });
    store.set({ playing: true });
    expect(store.get()).toEqual({
      itemId: 'a',
      position: 1,
      duration: 10,
      buffered: 3,
      playing: true,
      scrolling: false,
    });
    expect(calls).toBe(2);

    off();
    store.set({ position: 2 });
    expect(calls).toBe(2);
  });

  it('reset clears the old item, so the scrubber never shows its duration', () => {
    const store = createProgressStore();
    store.set({ itemId: 'a', position: 5, duration: 10, buffered: 6, playing: true });
    store.reset('b');
    expect(store.get()).toEqual({
      itemId: 'b',
      position: 0,
      duration: 0,
      buffered: 0,
      playing: false,
      scrolling: false,
    });
  });

  it('reset keeps the scrolling flag, the page change is what set it', () => {
    const store = createProgressStore();
    store.set({ scrolling: true });
    store.reset('b');
    expect(store.get().scrolling).toBe(true);
  });

  it('keeps a stable snapshot between changes', () => {
    const store = createProgressStore();
    store.set({ itemId: 'a' });
    expect(store.get()).toBe(store.get());
  });
});
