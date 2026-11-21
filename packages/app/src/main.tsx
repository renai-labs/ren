import "./main.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app.js"
import { Runtime } from "./lib/runtime.js"
import { ChatDatabase } from "./platform/chat-database.js"
import { DraftDatabase } from "./platform/draft-database.js"
import { LayoutShift } from "./platform/layout-shift.js"
import { createWebPlatform } from "./platform/web.js"

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root element")

if (import.meta.env.DEV) LayoutShift.watch()

void Promise.all([DraftDatabase.open(), ChatDatabase.open()]).then((stores) =>
  createRoot(root).render(
    <StrictMode>
      <App runtime={Runtime.make(createWebPlatform({ large: stores[0], chatCache: stores[1] }))} />
    </StrictMode>,
  ),
)
