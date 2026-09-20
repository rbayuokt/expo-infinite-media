import type { NativeItem } from '../ExpoInfiniteMediaModule';

export type ItemsOp =
  | { kind: 'none' }
  | { kind: 'append'; items: NativeItem[] }
  | { kind: 'replace'; items: NativeItem[] };

function same(a: NativeItem, b: NativeItem): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.uri === b.uri &&
    a.poster === b.poster &&
    a.cacheKey === b.cacheKey &&
    // Headers usually come from the same object or a small literal.
    JSON.stringify(a.headers) === JSON.stringify(b.headers)
  );
}

/** Appends send only the tail. Anything else resends the list and native keeps state by id. */
export function diffItems(prev: readonly NativeItem[], next: readonly NativeItem[]): ItemsOp {
  if (next.length >= prev.length) {
    let prefix = true;
    for (let i = 0; i < prev.length; i++) {
      if (!same(prev[i], next[i])) {
        prefix = false;
        break;
      }
    }
    if (prefix) {
      return next.length === prev.length
        ? { kind: 'none' }
        : { kind: 'append', items: next.slice(prev.length) };
    }
  }
  return { kind: 'replace', items: next.slice() };
}

/** Ids used more than once. Identity is the id, so duplicates break player binding. */
export function duplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) dup.add(id);
    else seen.add(id);
  }
  return [...dup];
}
