export * as ArtifactCloudflareCode from "./cloudflare-code.js"

import { createHash } from "node:crypto"

export const name = (identity: string) => `a-${createHash("sha256").update(identity).digest("hex").slice(0, 56)}`

export const marker = (deploymentId: string, proof: string) => `${deploymentId}:${proof}`

export const modules = (input: {
  readonly objects: Readonly<Record<string, string>>
  readonly active: { readonly source: string; readonly classes: ReadonlyArray<string> } | null
  readonly mode: "serving" | "stopped"
  readonly deploymentId: string
  readonly proof: string
}): Record<string, string> => {
  const active = input.mode === "serving" ? input.active : null
  const classes = [...new Set(active?.classes ?? [])]
  const retained = [...new Set(Object.values(input.objects))].filter((name) => !classes.includes(name))
  let handler =
    input.mode === "stopped"
      ? 'return new Response("Artifact stopped", { status: 410 });'
      : "return env.ASSETS.fetch(request);"
  if (active)
    handler = `if ((request.method === "GET" || request.method === "HEAD") && !request.headers.has("upgrade")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return application.fetch(request, env, ctx);`
  return {
    ...(active && { "active.js": active.source }),
    ...Object.fromEntries(
      retained.map((name, index) => [
        `retained-${index}.js`,
        `import { DurableObject } from "cloudflare:workers";
class InactiveObject extends DurableObject {
  fetch() { return new Response("This class is inactive after deployment recovery", { status: 503 }); }
}
export { InactiveObject as ${name} };`,
      ]),
    ),
    "main.js": [
      ...(active ? ['import application from "./active.js";'] : []),
      ...classes.map((name) => `export { ${name} } from "./active.js";`),
      ...retained.map((name, index) => `export { ${name} } from "./retained-${index}.js";`),
      `export default {
  async fetch(request, env, ctx) {
    if (request.headers.get("x-ren-artifact-probe") === "1")
      return new Response(${JSON.stringify(marker(input.deploymentId, input.proof))}, { headers: { "cache-control": "no-store" } });
    ${handler}
  }
};`,
    ].join("\n"),
  }
}
