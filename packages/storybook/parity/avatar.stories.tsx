import { Folder } from "ren-v1/icons"
import { Avatar } from "ren-v1/primitives/avatar"
import meta, { Image } from "../ui/avatar.stories.js"

export default { ...meta, component: Avatar }

export {
  Initials,
  ExtraSmall,
  Compact,
  Small,
  Large,
  ExtraLarge,
  Feature,
  Hero,
  Square,
  SquareFeature,
  Inverse,
  Unnamed,
  Decorative,
  Image,
  ImageContain,
} from "../ui/avatar.stories.js"

const picture = Image.args?.image
const tinted = (color: string) => ({ args: { icon: `tabler:IconCube:${color}`, shape: "square", size: "large" } })

export const ImageSubtle = { args: { icon: picture, size: "large", shape: "square", imageFit: "contain" } }
export const Glyph = { args: { glyph: <Folder />, shape: "square", size: "large" } }
export const GlyphInverse = { args: { glyph: <Folder />, tone: "inverse", size: "large" } }
export const TintNeutral = tinted("neutral")
export const TintContrast = tinted("cyan")
export const TintAccent = tinted("azure")
export const TintSuccess = tinted("green")
export const TintWarning = tinted("amber")
export const TintDanger = tinted("coral")
export const Emoji = { args: { icon: ":🚀", shape: "square", size: "large" } }

const people = [
  { key: "ada", name: "Ada Lovelace" },
  { key: "grace", name: "Grace Hopper" },
  { key: "alan", name: "Alan Turing" },
  { key: "edsger", name: "Edsger Dijkstra" },
  { key: "barbara", name: "Barbara Liskov" },
]

export const Group = { render: () => <Avatar presentation="group" items={people.slice(0, 3)} /> }
export const GroupOverflow = { render: () => <Avatar presentation="group" items={people} limit={3} /> }
export const GroupImages = {
  render: () => (
    <Avatar
      presentation="group"
      items={people.map((person) => ({ key: person.key, name: person.name, image: picture }))}
      size="extra-small"
    />
  ),
}
