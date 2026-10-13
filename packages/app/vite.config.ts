import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import type { IncomingMessage } from "node:http"
import { defineConfig } from "vite"
import openapi from "../protocol/openapi.json" with { type: "json" }

const target = process.env.REN_API_URL ?? "http://localhost:4000"

const apiPathSegments = new Set(Object.keys(openapi.paths).map((path) => path.split("/")[1]))

export default defineConfig({
  plugins: [tanstackRouter(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    proxy: {
      "/auth": target,
      "/openapi.json": target,
      ...Object.fromEntries(
        [...apiPathSegments].map((pathSegment) => [
          `^/${pathSegment}(?:[/?]|$)`,
          {
            target,
            bypass: (request: IncomingMessage) =>
              request.headers.accept?.includes("text/html") ? "/index.html" : null,
          },
        ]),
      ),
    },
  },
})
