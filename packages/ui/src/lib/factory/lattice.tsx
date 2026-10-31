export type LatticeVariant = "S1" | "S2" | "S3" | "S4" | "S5"

const N = 3
const MID = (N - 1) / 2
const RING: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
]
const RING_INDEX = new Map(RING.map(([x, y], i) => [`${x},${y}`, i]))
const LIT = new Set([0, 6])
const MID_INK = new Set([1, 3, 5, 7])
const GRID = Array.from({ length: N * N }, (_, index) => ({ index, x: index % N, y: Math.floor(index / N) }))

function delay(variant: LatticeVariant, x: number, y: number): number {
  const dx = x - MID
  const dy = y - MID
  const ring = RING_INDEX.get(`${x},${y}`)
  switch (variant) {
    case "S1":
      return Math.hypot(dx, dy) * 700 - (dx === 0 && dy === 0 ? 180 : 0)
    case "S2":
      return ((x + y) / (2 * (N - 1))) * 1500
    case "S3":
      return ring === undefined ? 0 : -(((RING.length - ring) % RING.length) / RING.length) * 1700
    case "S4":
      return (x / (N - 1)) * 1100
    case "S5":
      return ring === undefined ? 0 : -(((ring * 3) % RING.length) / RING.length) * 1700
  }
}

export function Lattice({
  size = 14,
  variant = "S3",
  label = "Agent working",
}: {
  size?: 12 | 14
  variant?: LatticeVariant
  label?: string
}) {
  const cell = size === 14 ? 4 : 3.4
  const pitch = size === 14 ? 5 : 4.3
  return (
    <span
      className="f-lattice"
      data-variant={variant}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a glyph drawn from animated spans, not an image file
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      {GRID.map((point) => (
        <span
          key={point.index}
          className="f-lattice-cell"
          data-still={
            (variant === "S3" || variant === "S5") && !RING_INDEX.has(`${point.x},${point.y}`) ? "" : undefined
          }
          data-lit={LIT.has(point.index) ? "" : undefined}
          data-mid={MID_INK.has(point.index) ? "" : undefined}
          style={{
            left: point.x * pitch,
            top: point.y * pitch,
            width: cell,
            height: cell,
            borderRadius: 0.7,
            animationDelay: `${delay(variant, point.x, point.y)}ms`,
          }}
        />
      ))}
    </span>
  )
}
