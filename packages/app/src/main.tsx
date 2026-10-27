import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import "./index.css"
import { queryClient } from "@/lib/api"
import { watchLayoutShift } from "@/lib/layout-shift"
import { router } from "@/router"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

if (import.meta.env.DEV) watchLayoutShift()

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
