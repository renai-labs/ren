import { Document } from "ren-v1/composites/document"
import meta from "../ui/document.stories.js"

export default { ...meta, component: Document }

export { Compact, Standard, Secondary, Streaming, Table } from "../ui/document.stories.js"

export const Code = {
  render: () => (
    <Document format="code" content="ren sync --check" wrapping="preformatted" height="content" syntax="shell" />
  ),
}
export const Media = {
  render: () => (
    <Document format="media" kind="embed" source="about:blank" description="Setup walkthrough" loading="eager" />
  ),
}
