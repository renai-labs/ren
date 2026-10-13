import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig((env) => ({
  base: "/app/",
  plugins: [tanstackRouter(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  define:
    env.command === "serve"
      ? {
          "import.meta.env.VITE_REN_API_URL": JSON.stringify(
            loadEnv(env.mode, process.cwd(), "VITE_").VITE_REN_API_URL ?? "http://localhost:4000",
          ),
        }
      : {},
}))
