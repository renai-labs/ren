export type Rng = () => number

export function hash(...parts: Array<string | number>): number {
  let h = 2166136261
  for (const part of parts) {
    const text = String(part)
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x2f
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rngFor(...parts: Array<string | number>): Rng {
  let a = hash(...parts) || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function between(rng: Rng, min: number, max: number, skew = 1): number {
  return min + (max - min) * rng() ** skew
}

export function pick<T>(rng: Rng, items: readonly T[] & { 0: T }): T {
  const [first] = items
  return items.at(Math.floor(rng() * items.length)) ?? first
}

export function poisson(rng: Rng, lambda: number): number {
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > limit)
  return k - 1
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ulid(at: number, ...seed: Array<string | number>): string {
  const rng = rngFor("ulid", ...seed)
  let time = ""
  let t = Math.floor(at)
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  let random = ""
  for (let i = 0; i < 16; i++) random += CROCKFORD[Math.floor(rng() * 32)]
  return time + random
}
