// The order a case's images are fetched in. The viewer shows the first image as
// soon as it and the images next to it have arrived, and fetches the rest while
// the case is read, always the waiting image nearest the one on screen.

/** The waiting slice nearest `focus`, the one below first when two are as near; -1 when none wait. */
export function nearestWaiting(waiting: readonly boolean[], focus: number): number {
  const from = Math.max(0, Math.min(waiting.length - 1, Math.round(focus)));
  for (let d = 0; d < waiting.length; d++) {
    if (from + d < waiting.length && waiting[from + d]) return from + d;
    if (d > 0 && from - d >= 0 && waiting[from - d]) return from - d;
  }
  return -1;
}

export class SliceQueue {
  readonly #waiting: boolean[];
  readonly #load: (slice: number) => Promise<void>;
  #stopped = false;
  /** The slice on screen. Each fetch takes the waiting slice nearest to it. */
  focus = 0;

  constructor(total: number, load: (slice: number) => Promise<void>) {
    this.#waiting = new Array<boolean>(total).fill(true);
    this.#load = load;
  }

  /** Fetch up to `count` more slices, nearest the focus first, `parallel` at a time. */
  async take(count: number, parallel: number): Promise<void> {
    let left = count;
    const worker = async () => {
      while (!this.#stopped && left > 0) {
        const slice = nearestWaiting(this.#waiting, this.focus);
        if (slice < 0) return;
        this.#waiting[slice] = false;
        left--;
        await this.#load(slice);
      }
    };
    await Promise.all(Array.from({ length: Math.max(0, Math.min(parallel, count)) }, worker));
  }

  /** No more fetches start; those already started finish. */
  stop(): void {
    this.#stopped = true;
  }
}
