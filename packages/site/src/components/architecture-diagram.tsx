type Box = { x: number; y: number; width: number; height: number }

type Layer = {
  title: string
  box: Box
  labels: string[]
  labelsX: number
}

const LAYERS: Layer[] = [
  {
    title: "Ren",
    box: { x: 180, y: 140, width: 920, height: 280 },
    labels: ["Sales", "Engineering", "Marketing", "Ops", "Finance"],
    labelsX: 220,
  },
  {
    title: "Servers",
    box: { x: 360, y: 170, width: 720, height: 220 },
    labels: ["Teams", "Credentials", "Environment"],
    labelsX: 400,
  },
  {
    title: "Projects",
    box: { x: 580, y: 200, width: 480, height: 160 },
    labels: ["Files", "Memory", "Triggers"],
    labelsX: 620,
  },
  {
    title: "Agents",
    box: { x: 830, y: 230, width: 210, height: 100 },
    labels: ["Skills", "MCPs", "Permissions"],
    labelsX: 860,
  },
]

const MID_Y = 280
const LABEL_FONT_SIZE = 16
const LINE_HEIGHT = 28
const TITLE_FONT_SIZE = 14
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"
const TITLE_MONO_CHAR_WIDTH = 8.4
const TITLE_PAD = 8
const ARROW_GAP = 14

const ARROWS: { x1: number; x2: number }[] = [
  { x1: 125, x2: 200 },
  { x1: 345, x2: 380 },
  { x1: 525, x2: 600 },
  { x1: 715, x2: 840 },
]

const DASH = { x1: 985, x2: 1155 }

function LabelStack({ labels, x }: { labels: string[]; x: number }) {
  const startY = MID_Y - ((labels.length - 1) * LINE_HEIGHT) / 2
  return (
    <g className="text-foreground/85">
      {labels.map((label, i) => (
        <text
          key={label}
          x={x}
          y={startY + i * LINE_HEIGHT}
          fontSize={LABEL_FONT_SIZE}
          fill="currentColor"
          fontFamily={MONO}
          dominantBaseline="middle"
        >
          {label}
        </text>
      ))}
    </g>
  )
}

type Segment = { from: number; to: number }

function segmentsAround(start: number, end: number, gap: Segment) {
  const segments: Segment[] = [
    { from: start, to: gap.from },
    { from: Math.max(start, gap.to), to: end },
  ]
  return segments.filter((segment) => segment.from < segment.to)
}

function BoxBorder({ layer }: { layer: Layer }) {
  const box = layer.box
  const x2 = box.x + box.width
  const y2 = box.y + box.height
  const topSegments = segmentsAround(box.x, x2, {
    from: layer.labelsX - TITLE_PAD,
    to: layer.labelsX + layer.title.length * TITLE_MONO_CHAR_WIDTH + TITLE_PAD,
  })
  const sideSegments = segmentsAround(box.y, y2, { from: MID_Y - ARROW_GAP / 2, to: MID_Y + ARROW_GAP / 2 })

  return (
    <g stroke="currentColor" strokeWidth="1" fill="none">
      {topSegments.map((segment) => (
        <line key={`t-${segment.from}`} x1={segment.from} y1={box.y} x2={segment.to} y2={box.y} />
      ))}
      <line x1={box.x} y1={y2} x2={x2} y2={y2} />
      {sideSegments.map((segment) => (
        <line key={`l-${segment.from}`} x1={box.x} y1={segment.from} x2={box.x} y2={segment.to} />
      ))}
      {sideSegments.map((segment) => (
        <line key={`r-${segment.from}`} x1={x2} y1={segment.from} x2={x2} y2={segment.to} />
      ))}
    </g>
  )
}

export function ArchitectureDiagram() {
  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox="0 100 1280 360"
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full text-muted-foreground"
        fill="none"
      >
        <defs>
          <marker
            id="arrow-end"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {LAYERS.map((layer) => (
          <g key={layer.title} className="text-muted-foreground/60">
            <BoxBorder layer={layer} />
            <text
              x={layer.labelsX}
              y={layer.box.y}
              fontSize={TITLE_FONT_SIZE}
              fill="currentColor"
              fontFamily={MONO}
              dominantBaseline="middle"
              className="text-foreground/70"
            >
              {layer.title}
            </text>
          </g>
        ))}

        {LAYERS.map((layer) => (
          <LabelStack key={`labels-${layer.title}`} labels={layer.labels} x={layer.labelsX} />
        ))}

        <g className="text-foreground" fontFamily={MONO}>
          <text x="40" y={MID_Y} fontSize={LABEL_FONT_SIZE} fill="currentColor" dominantBaseline="middle">
            Company
          </text>
          <text x="1170" y={MID_Y} fontSize={LABEL_FONT_SIZE} fill="currentColor" dominantBaseline="middle">
            Outcome
          </text>
        </g>

        <g className="text-muted-foreground" stroke="currentColor" strokeWidth="1.25">
          {ARROWS.map((a) => (
            <line
              key={`${a.x1}-${a.x2}`}
              x1={a.x1}
              y1={MID_Y}
              x2={a.x2}
              y2={MID_Y}
              markerStart="url(#arrow-end)"
              markerEnd="url(#arrow-end)"
            />
          ))}
          <line x1={DASH.x1} y1={MID_Y} x2={DASH.x2} y2={MID_Y} strokeDasharray="2 5" markerEnd="url(#arrow-end)" />
        </g>
      </svg>
    </div>
  )
}
