import plugin from "tailwindcss/plugin"

// oxlint-disable-next-line import/no-default-export, ren/no-comments -- Tailwind loads a plugin from its default export. Its own group-has-[…]/name nests :has() inside :is(), which makes Chrome restyle the whole page on every DOM change; this emits the same condition as a plain descendant selector.
export default plugin((api) => {
  api.matchVariant(
    "group-has",
    (value, { modifier }) => `:where(.group${modifier ? `\\/${modifier}` : ""}):has(${value}) &`,
  )
})
