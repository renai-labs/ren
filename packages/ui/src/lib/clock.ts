const TICK = 30_000

const listeners = new Set<() => void>()
const state: { now: number; timer: ReturnType<typeof setInterval> | undefined } = {
  now: Date.now(),
  timer: undefined,
}

function tick() {
  state.now = Date.now()
  for (const listener of listeners) listener()
}

export function subscribeClock(listener: () => void) {
  listeners.add(listener)
  if (state.timer === undefined) {
    state.now = Date.now()
    state.timer = setInterval(tick, TICK)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function readClock() {
  return state.now
}
