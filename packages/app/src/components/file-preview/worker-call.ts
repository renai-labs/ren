export const workerTimeoutMs = 30_000

type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }

export function workerCalls(create: () => Worker) {
  const worker = create()
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const state = { next: 0, closed: false }
  const fail = (error: Error) => {
    state.closed = true
    worker.terminate()
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  worker.addEventListener("message", (event: MessageEvent<Reply>) => {
    const entry = pending.get(event.data.id)
    pending.delete(event.data.id)
    if (event.data.ok) entry?.resolve(event.data.value)
    else entry?.reject(new Error(event.data.error))
  })
  worker.addEventListener("error", () => fail(new Error("The worker crashed")))
  worker.addEventListener("messageerror", () => fail(new Error("The worker sent an unreadable reply")))
  return {
    call(message: object, transfer: Transferable[] = []) {
      if (state.closed) return Promise.reject(new Error("The worker is closed"))
      const id = state.next++
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error("The worker timed out")), workerTimeoutMs)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        worker.postMessage({ ...message, id }, transfer)
      })
    },
    close() {
      fail(new Error("The worker is closed"))
    },
  }
}
