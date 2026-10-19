import "./main.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app.js"
import { Runtime } from "./lib/runtime.js"
import { Keyboard } from "./platform/keyboard.js"
import { createWebPlatform } from "./platform/web.js"

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root element")

Keyboard.trackInsets()

createRoot(root).render(
  <StrictMode>
    <App runtime={Runtime.make(createWebPlatform())} />
  </StrictMode>,
)
