import { useId } from "react"

type Box = { x: number; y: number; width: number; height: number }

export type Layer = {
  title: string
  box: Box
  labels: string[]
  labelsX: number
}

type Edge = { text: string; x: number }

const MID_Y = 280
const LABEL_FONT_SIZE = 16
const LINE_HEIGHT = 28
const TITLE_FONT_SIZE = 14
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"
const TITLE_MONO_CHAR_WIDTH = 8.4
const TITLE_PAD = 8
const ARROW_GAP = 14

function LabelStack(props: { labels: string[]; x: number; scale: number }) {
  const lineHeight = LINE_HEIGHT * props.scale
  const startY = MID_Y - ((props.labels.length - 1) * lineHeight) / 2
  return (
    <g className="text-(--diagram-fg)/85">
      {props.labels.map((label, i) => (
        <text
          key={label}
          x={props.x}
          y={startY + i * lineHeight}
          fontSize={LABEL_FONT_SIZE * props.scale}
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

function BoxBorder(props: { layer: Layer; scale: number }) {
  const box = props.layer.box
  const x2 = box.x + box.width
  const y2 = box.y + box.height
  const topSegments = segmentsAround(box.x, x2, {
    from: props.layer.labelsX - TITLE_PAD,
    to: props.layer.labelsX + props.layer.title.length * TITLE_MONO_CHAR_WIDTH * props.scale + TITLE_PAD,
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

export function LayerDiagram(props: {
  colors: string
  viewBox: string
  layers: Layer[]
  start: Edge
  end: Edge
  arrows: { x1: number; x2: number }[]
  dash: { x1: number; x2: number }
  fontScale?: number
}) {
  const marker = useId()
  const scale = props.fontScale ?? 1
  return (
    <div className={`w-full overflow-hidden ${props.colors}`}>
      <svg
        viewBox={props.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full text-(--diagram-muted)"
        fill="none"
      >
        <defs>
          <marker
            id={marker}
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

        {props.layers.map((layer) => (
          <g key={layer.title} className="text-(--diagram-muted)/60">
            <BoxBorder layer={layer} scale={scale} />
            <text
              x={layer.labelsX}
              y={layer.box.y}
              fontSize={TITLE_FONT_SIZE * scale}
              fill="currentColor"
              fontFamily={MONO}
              dominantBaseline="middle"
              className="text-(--diagram-fg)/70"
            >
              {layer.title}
            </text>
          </g>
        ))}

        {props.layers.map((layer) => (
          <LabelStack key={`labels-${layer.title}`} labels={layer.labels} x={layer.labelsX} scale={scale} />
        ))}

        <g className="text-(--diagram-fg)" fontFamily={MONO}>
          <text
            x={props.start.x}
            y={MID_Y}
            fontSize={LABEL_FONT_SIZE * scale}
            fill="currentColor"
            dominantBaseline="middle"
          >
            {props.start.text}
          </text>
          <text
            x={props.end.x}
            y={MID_Y}
            fontSize={LABEL_FONT_SIZE * scale}
            fill="currentColor"
            dominantBaseline="middle"
          >
            {props.end.text}
          </text>
        </g>

        <g className="text-(--diagram-muted)" stroke="currentColor" strokeWidth="1.25">
          {props.arrows.map((arrow) => (
            <line
              key={`${arrow.x1}-${arrow.x2}`}
              x1={arrow.x1}
              y1={MID_Y}
              x2={arrow.x2}
              y2={MID_Y}
              markerStart={`url(#${marker})`}
              markerEnd={`url(#${marker})`}
            />
          ))}
          <line
            x1={props.dash.x1}
            y1={MID_Y}
            x2={props.dash.x2}
            y2={MID_Y}
            strokeDasharray="2 5"
            markerEnd={`url(#${marker})`}
          />
        </g>
      </svg>
    </div>
  )
}
