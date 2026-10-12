export * as RouterContext from "./router-context.js"

import { useRouteContext } from "@tanstack/react-router"

export function useRouterContext() {
  return useRouteContext({ from: "__root__" })
}
