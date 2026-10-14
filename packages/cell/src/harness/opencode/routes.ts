export * as OpenCodeRoutes from "./routes.js"

export const serverOnly = [
  /^\/api\/credential(\/|$)/,
  /^\/api\/integration\/[^/]+\/connect(\/|$)/,
  /^\/api\/experimental\/integration(\/|$)/,
]
