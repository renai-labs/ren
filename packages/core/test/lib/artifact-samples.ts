export * as ArtifactSamples from "./artifact-samples.js"

export const files = async (name: string) => {
  const root = new URL(`../fixtures/artifacts/${name}/`, import.meta.url).pathname
  const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }))
  return Object.fromEntries(
    await Promise.all(
      paths
        .filter((path) => path !== "wrangler.jsonc")
        .map(async (path): Promise<[string, Uint8Array]> => [
          path.replace(/^public\//u, ""),
          new Uint8Array(await Bun.file(`${root}${path}`).arrayBuffer()),
        ]),
    ),
  )
}
