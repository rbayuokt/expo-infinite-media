import type { NativeItem } from '../../ExpoInfiniteMediaModule';
import { diffItems, duplicateIds } from '../diff';
import { clampIndex, mountWindow, shouldFireEndReached } from '../window';

const v = (id: string, uri = `https://x/${id}.mp4`): NativeItem => ({ id, type: 'video', uri });

describe('mountWindow', () => {
  it('centers and clamps', () => {
    expect(mountWindow(0, 2, 10)).toEqual([0, 1, 2]);
    expect(mountWindow(5, 2, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(mountWindow(9, 2, 10)).toEqual([7, 8, 9]);
    expect(mountWindow(0, 2, 0)).toEqual([]);
  });

  it('jumping far only mounts the target window', () => {
    expect(mountWindow(500, 2, 1000)).toEqual([498, 499, 500, 501, 502]);
  });

  it('clamps an index past the end', () => {
    expect(mountWindow(50, 1, 3)).toEqual([1, 2]);
    expect(clampIndex(-3, 5)).toBe(0);
  });
});

describe('shouldFireEndReached', () => {
  it('fires inside the threshold', () => {
    expect(shouldFireEndReached(5, 10, 3)).toBe(false);
    expect(shouldFireEndReached(6, 10, 3)).toBe(true);
    expect(shouldFireEndReached(0, 0, 3)).toBe(false);
  });
});

describe('diffItems', () => {
  const base = [v('a'), v('b'), v('c')];

  it('no change', () => {
    expect(diffItems(base, [v('a'), v('b'), v('c')])).toEqual({ kind: 'none' });
  });

  it('append 20 sends only the tail', () => {
    const more = Array.from({ length: 20 }, (_, i) => v(`n${i}`));
    const op = diffItems(base, [...base, ...more]);
    expect(op.kind).toBe('append');
    expect(op.kind === 'append' && op.items.map((i) => i.id)).toEqual(more.map((i) => i.id));
  });

  it('replace when order or content changes', () => {
    expect(diffItems(base, [v('b'), v('a'), v('c')]).kind).toBe('replace');
    expect(diffItems(base, [v('a'), v('b', 'https://other')]).kind).toBe('replace');
    expect(diffItems(base, [v('a')]).kind).toBe('replace');
  });

  it('first load is an append from empty', () => {
    expect(diffItems([], base).kind).toBe('append');
  });

  it('1000 items', () => {
    const big = Array.from({ length: 1000 }, (_, i) => v(String(i)));
    expect(diffItems(big, big.slice()).kind).toBe('none');
  });
});

describe('duplicateIds', () => {
  it('reports repeats once', () => {
    expect(duplicateIds([v('a'), v('b'), v('a'), v('a')])).toEqual(['a']);
  });
});
