export * as Avatars from "./avatars.js"

const load = (files: Readonly<Record<string, string>>) =>
  Object.entries(files)
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => {
      const word = entry[0].replace(/^.*\/\d+-/u, "").replace(/\.svg$/u, "")
      return {
        name: word.charAt(0).toUpperCase() + word.slice(1),
        url: `data:image/svg+xml;utf8,${encodeURIComponent(entry[1].trim())}`,
      }
    })

export const presets = {
  person: load(import.meta.glob<string>("./avatars/people/*.svg", { query: "?raw", import: "default", eager: true })),
  organization: load(
    import.meta.glob<string>("./avatars/organizations/*.svg", { query: "?raw", import: "default", eager: true }),
  ),
}
