import { describe, expect, it } from "vitest";
import { nearestWaiting, SliceQueue } from "./slices";

describe("nearestWaiting", () => {
  it("starts at the focus, then works outward, below first", () => {
    const waiting = new Array(10).fill(true);
    const order: number[] = [];
    for (let s = nearestWaiting(waiting, 4); s >= 0; s = nearestWaiting(waiting, 4)) {
      order.push(s);
      waiting[s] = false;
    }
    expect(order).toEqual([4, 5, 3, 6, 2, 7, 1, 8, 0, 9]);
  });

  it("skips slices already taken and copes with a focus off either end", () => {
    expect(nearestWaiting([false, false, true, true], 0)).toBe(2);
    expect(nearestWaiting([true, false, false], 99)).toBe(0);
    expect(nearestWaiting([false, false], 1)).toBe(-1);
    expect(nearestWaiting([], 0)).toBe(-1);
  });
});

describe("SliceQueue", () => {
  const delay = () => new Promise((r) => setTimeout(r, 1));

  it("loads the first slices, then the rest, each slice once", async () => {
    const loaded: number[] = [];
    const queue = new SliceQueue(20, async (s) => {
      await delay();
      loaded.push(s);
    });
    await queue.take(5, 3);
    expect([...loaded].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    await queue.take(Infinity, 3);
    expect([...loaded].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("follows the focus when the reader moves", async () => {
    const loaded: number[] = [];
    const queue = new SliceQueue(100, async (s) => {
      loaded.push(s);
    });
    await queue.take(3, 1);
    queue.focus = 60;
    await queue.take(3, 1);
    expect(loaded).toEqual([0, 1, 2, 60, 61, 59]);
  });

  it("never has more than `parallel` fetches open", async () => {
    let open = 0;
    let most = 0;
    const queue = new SliceQueue(30, async () => {
      most = Math.max(most, ++open);
      await delay();
      open--;
    });
    await queue.take(Infinity, 4);
    expect(most).toBe(4);
  });

  it("starts nothing new once stopped", async () => {
    const loaded: number[] = [];
    const queue = new SliceQueue(50, async (s) => {
      loaded.push(s);
      if (loaded.length === 3) queue.stop();
      await delay();
    });
    await queue.take(Infinity, 1);
    expect(loaded).toEqual([0, 1, 2]);
  });

  it("passes a failed fetch on", async () => {
    const queue = new SliceQueue(5, async (s) => {
      if (s === 2) throw new Error("slice 2: 404");
    });
    await expect(queue.take(Infinity, 2)).rejects.toThrow("slice 2: 404");
  });
});
