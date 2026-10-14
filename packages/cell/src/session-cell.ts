import { DurableObject } from "cloudflare:workers"
import { Layer, ManagedRuntime } from "effect"
import { Brain } from "./brain.js"
import { Cell } from "./cell.js"

export class SessionCell extends DurableObject {
  readonly runtime = ManagedRuntime.make(
    Brain.layer.pipe(Layer.provideMerge(Cell.layer(this.ctx.storage, this.ctx.id.name, this.env))),
  )

  override fetch(request: Request) {
    return this.runtime.runPromise(Cell.fetch(request))
  }

  override alarm() {
    return this.runtime.runPromise(Cell.alarm())
  }
}
