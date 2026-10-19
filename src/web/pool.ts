export type PooledVideo = {
  el: HTMLVideoElement;
  itemId: string | null;
};

export class VideoPool {
  private slots: PooledVideo[] = [];

  constructor(readonly capacity: number) {}

  take(itemId: string, keep: readonly string[]): PooledVideo {
    const mine = this.slots.find((s) => s.itemId === itemId);
    if (mine) return mine;

    if (this.slots.length < this.capacity) {
      const el = document.createElement('video');
      el.playsInline = true;
      el.preload = 'auto';
      el.muted = true;
      const slot: PooledVideo = { el, itemId };
      this.slots.push(slot);
      return slot;
    }

    const free = this.slots.find((s) => s.itemId === null || !keep.includes(s.itemId));
    const slot = free ?? this.slots[this.slots.length - 1];
    this.release(slot);
    slot.itemId = itemId;
    return slot;
  }

  release(slot: PooledVideo) {
    slot.el.pause();
    slot.el.removeAttribute('src');
    slot.el.load();
    slot.itemId = null;
  }

  releaseAllExcept(keep: readonly string[]) {
    for (const slot of this.slots) {
      if (slot.itemId && !keep.includes(slot.itemId)) this.release(slot);
    }
  }

  elements(): HTMLVideoElement[] {
    return this.slots.map((s) => s.el);
  }

  find(itemId: string): PooledVideo | undefined {
    return this.slots.find((s) => s.itemId === itemId);
  }

  destroy() {
    this.slots.forEach((s) => this.release(s));
    this.slots = [];
  }
}
