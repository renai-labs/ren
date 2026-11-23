// oxlint-disable-next-line ren/no-comments -- Writes the copy of models.dev that Ren uses at start until the list job stores one (Providers P9). Pass a saved answer of models.dev to read it instead.
import { ModelCatalog } from "../src/model-catalog.js"

const file = process.argv[2]
const raw: unknown = file ? await Bun.file(file).json() : await (await fetch(ModelCatalog.url)).json()
const data = ModelCatalog.normalize(raw, ModelCatalog.offered)
await Bun.write(new URL("../src/model-catalog/snapshot.json", import.meta.url), `${JSON.stringify(data)}\n`)
console.log(
  `${data.providers.length} providers, ${data.providers.reduce((sum, provider) => sum + provider.models.length, 0)} models`,
)
