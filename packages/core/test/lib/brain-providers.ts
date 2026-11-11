export * as BrainProviders from "./brain-providers.js"

import { BrainProvider } from "../../src/brain-provider.js"

// oxlint-disable-next-line ren/no-comments -- For tests that change spaces but start no brain: a Ren that registers no brain provider, so a hand change skips the brain provider's checks.
export const none = BrainProvider.layer([])
