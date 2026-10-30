import { generateKeyBetween } from 'fractional-indexing'

// Key strictly between a and b. A few random halvings of the gap keep two devices inserting
// into the same gap from producing identical keys (1 in 4096); ties left over are broken by id.
export function between(a: string | null, b: string | null): string {
  if (a && b && a >= b) b = null // concurrent duplicates: fall back to "after a"
  let k = generateKeyBetween(a, b)
  for (let i = 0; i < 12; i++) {
    if (Math.random() < 0.5) a = k
    else b = k
    k = generateKeyBetween(a, b)
  }
  return k
}

export function sortByPos<T extends { pos: string; id: string }>(xs: T[]): T[] {
  return [...xs].sort((x, y) => (x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}

// Key for dropping at `index` of an already-sorted list that excludes the moving item.
export function keyAt<T extends { pos: string }>(sorted: T[], index: number): string {
  return between(sorted[index - 1]?.pos ?? null, sorted[index]?.pos ?? null)
}
