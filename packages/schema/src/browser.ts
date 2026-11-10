export * as Browser from "./browser.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.String.annotate({ description: "The provider’s ID of the browser." }),
  provider: Schema.Literal("kernel"),
  liveView: Schema.String.annotate({ description: "The address of the page that streams the browser." }),
  url: Schema.String.annotate({ description: "The address of the current page. Empty until Ren reads it." }),
  title: Schema.String,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
}).annotate({ identifier: "Browser.Info" })
