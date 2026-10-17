export * as Wait from "./wait.js"

export const deadline = <A>(label: string, ms: number, work: Promise<A>, diagnose: () => string = () => "") => {
  const timer = Promise.withResolvers<never>()
  const handle = setTimeout(() => {
    const diagnostic = diagnose()
    timer.reject(new Error(`${label} did not finish within ${ms} ms${diagnostic ? `: ${diagnostic}` : ""}`))
  }, ms)
  return Promise.race([work, timer.promise]).finally(() => clearTimeout(handle))
}

export const until = async <A>(
  label: string,
  ms: number,
  check: () => Promise<A | undefined> | A | undefined,
  diagnose: () => string = () => "",
): Promise<A> => {
  const end = Date.now() + ms
  const poll = async (): Promise<A> => {
    const found = await check()
    if (found !== undefined) return found
    if (Date.now() > end) {
      const diagnostic = diagnose()
      throw new Error(`${label} did not finish within ${ms} ms${diagnostic ? `: ${diagnostic}` : ""}`)
    }
    await Bun.sleep(50)
    return poll()
  }
  return poll()
}

export const seed = Number(process.env.CHAOS_SEED ?? 20_261_016)

export const random = (label: string, from = seed) => {
  const state = {
    value:
      Array.from(label, (character) => character.charCodeAt(0)).reduce(
        (hash, code) => Math.imul(hash ^ code, 16_777_619) >>> 0,
        from >>> 0,
      ) || 1,
  }
  const next = () => {
    state.value = (state.value + 0x6d_2b_79_f5) >>> 0
    const mixed = Math.imul(state.value ^ (state.value >>> 15), state.value | 1)
    const scrambled = (mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61))) >>> 0
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4_294_967_296
  }
  return { integer: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) }
}
