export * as Shared from "./shared.js"

import { Celld } from "./celld.js"
import { StubModel } from "./stub-model.js"

const state = {
  stub: undefined as StubModel.Server | undefined,
  celld: undefined as Promise<Celld.Instance> | undefined,
}

export const stub = () => (state.stub ??= StubModel.start())

export const vars = () => ({ STUB_URL: stub().cellUrl })

export const celld = () => (state.celld ??= Celld.make(vars()))

export const dispose = async () => {
  await state.celld?.then((instance) => instance.dispose())
  await state.stub?.stop()
}
