type Vector = { x: number; y: number; z: number }
type Edge = { a: number; b: number }
type Geometry = { points: Vector[]; edges: Edge[] }
type Pulse = { origin: Vector; startTime: number }
type Cursor = { x: number; y: number }
type View = { width: number; height: number; rx: number; ry: number; radius: number }
type Interaction = { cursor: Cursor | undefined; pulses: Pulse[]; time: number }
type Placed = { rotated: Vector; projected: Vector }
type DrawnEdge = { start: Placed; end: Placed; zAvg: number }

const TAU = Math.PI * 2
const PHI = (1 + Math.sqrt(5)) / 2
const GROWTH_DURATION = 5000
const RADIUS_MIN_SCALE = 0.85
const RADIUS_SCALE = 0.42
const PULSE_LIFETIME = 2200

const STAGES = [
  { n: 1, neighbors: 0, jitter: 0, duration: 400 },
  { n: 4, neighbors: 2, jitter: 0.55, duration: 600 },
  { n: 14, neighbors: 3, jitter: 0.32, duration: 800 },
  { n: 45, neighbors: 4, jitter: 0.14, duration: 1000 },
  { n: 110, neighbors: 5, jitter: 0.07, duration: 1100 },
  { n: 260, neighbors: 6, jitter: 0.03, duration: 1100 },
]

const TOTAL_STAGE_TIME = STAGES.reduce((total, stage) => total + stage.duration, 0)

const TRANSITIONS = STAGES.map((from, index) => ({
  from,
  to: STAGES.at(index + 1) ?? from,
  start: STAGES.slice(0, index).reduce((total, stage) => total + stage.duration, 0),
}))

function fibonacciSphere(n: number, jitter: number): Vector[] {
  if (n === 1) return [{ x: 0, y: 0, z: 1 }]
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = (TAU * i) / PHI
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    if (jitter <= 0) return { x, y, z }
    const h = Math.sin(i * 12.9898) * 43758.5453
    const h2 = Math.sin(i * 78.233) * 43758.5453
    const jx = x + (h - Math.floor(h) - 0.5) * jitter
    const jz = z + (h2 - Math.floor(h2) - 0.5) * jitter
    const m = Math.sqrt(jx * jx + y * y + jz * jz)
    return { x: jx / m, y: y / m, z: jz / m }
  })
}

function nearestNeighbourEdges(points: Vector[], k: number) {
  if (points.length < 2 || k < 1) return []
  const edges = points.flatMap((point, i) =>
    points
      .map((other, j) => {
        const dx = point.x - other.x
        const dy = point.y - other.y
        const dz = point.z - other.z
        return { j, distance: dx * dx + dy * dy + dz * dz }
      })
      .filter((neighbour) => neighbour.j !== i)
      .toSorted((left, right) => left.distance - right.distance)
      .slice(0, k)
      .map((neighbour) => ({ a: Math.min(i, neighbour.j), b: Math.max(i, neighbour.j) })),
  )
  return [...new Map(edges.map((edge) => [`${edge.a}_${edge.b}`, edge])).values()]
}

function sphereGeometry(shape: { n: number; jitter: number; neighbors: number }): Geometry {
  const points = fibonacciSphere(shape.n, shape.jitter)
  return { points, edges: nearestNeighbourEdges(points, shape.neighbors) }
}

const STAGE_GEOMETRY = STAGES.map((stage) => sphereGeometry(stage))

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function easeInOut(t: number) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function growingGeometry(elapsed: number) {
  const globalT = Math.min(1, elapsed / GROWTH_DURATION)
  const easedTime = easeInOut(globalT) * TOTAL_STAGE_TIME
  const transition = TRANSITIONS.reduce((current, next) => (easedTime >= next.start ? next : current))
  const localT = Math.min(1, (easedTime - transition.start) / transition.from.duration)
  const n = Math.max(1, Math.round(lerp(transition.from.n, transition.to.n, localT)))
  const k = Math.max(0, Math.round(lerp(transition.from.neighbors, transition.to.neighbors, localT)))
  return {
    geometry: sphereGeometry({
      n,
      jitter: lerp(transition.from.jitter, transition.to.jitter, localT),
      neighbors: Math.min(k, n - 1),
    }),
    scale: RADIUS_MIN_SCALE + (1 - RADIUS_MIN_SCALE) * globalT,
  }
}

function hoverGlow(edge: DrawnEdge, cursor: Cursor | undefined, radius: number) {
  if (!cursor) return 0
  const dx = (edge.start.projected.x + edge.end.projected.x) / 2 - cursor.x
  const dy = (edge.start.projected.y + edge.end.projected.y) / 2 - cursor.y
  const d = Math.sqrt(dx * dx + dy * dy)
  const glowRadius = radius * 0.5
  return d < glowRadius && edge.zAvg > -0.2 ? (1 - d / glowRadius) * 0.6 : 0
}

function pulseGlow(edge: DrawnEdge, interaction: Interaction) {
  const mid = {
    x: (edge.start.rotated.x + edge.end.rotated.x) / 2,
    y: (edge.start.rotated.y + edge.end.rotated.y) / 2,
    z: (edge.start.rotated.z + edge.end.rotated.z) / 2,
  }
  const bandWidth = 0.35
  return Math.max(
    0,
    ...interaction.pulses.map((pulse) => {
      const dot = mid.x * pulse.origin.x + mid.y * pulse.origin.y + mid.z * pulse.origin.z
      const age = (interaction.time - pulse.startTime) / 1000
      const diff = Math.abs(Math.acos(Math.max(-1, Math.min(1, dot))) - age * 2.2)
      return diff < bandWidth ? (1 - diff / bandWidth) * Math.max(0, 1 - age / 1.8) : 0
    }),
  )
}

function drawSphere(context: CanvasRenderingContext2D, sphere: Geometry, view: View, interaction?: Interaction) {
  context.clearRect(0, 0, view.width, view.height)
  const cosX = Math.cos(view.rx)
  const sinX = Math.sin(view.rx)
  const cosY = Math.cos(view.ry)
  const sinY = Math.sin(view.ry)
  const placed = sphere.points.map((point) => {
    const y1 = point.y * cosX - point.z * sinX
    const z1 = point.y * sinX + point.z * cosX
    const rotated = { x: point.x * cosY + z1 * sinY, y: y1, z: -point.x * sinY + z1 * cosY }
    return {
      rotated,
      projected: {
        x: view.width / 2 + rotated.x * view.radius,
        y: view.height / 2 + rotated.y * view.radius,
        z: rotated.z,
      },
    }
  })

  const first = placed.at(0)
  if (!first) return
  if (placed.length === 1) {
    context.fillStyle = "#ffffff"
    context.beginPath()
    context.arc(first.projected.x, first.projected.y, interaction ? 3 : 2, 0, TAU)
    context.fill()
    return
  }

  const edges = sphere.edges
    .flatMap((edge) => {
      const start = placed.at(edge.a)
      const end = placed.at(edge.b)
      return start && end ? [{ start, end, zAvg: (start.projected.z + end.projected.z) / 2 }] : []
    })
    .toSorted((left, right) => left.zAvg - right.zAvg)

  for (const edge of edges) {
    const depthFactor = (edge.zAvg + 1) / 2
    const hover = interaction ? hoverGlow(edge, interaction.cursor, view.radius) : 0
    const pulse = interaction ? pulseGlow(edge, interaction) : 0
    context.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.08 + depthFactor * 0.75 + hover + pulse * 0.8)})`
    context.lineWidth = interaction ? 0.6 + depthFactor * 0.5 + pulse * 1.2 : 0.5 + depthFactor * 0.3
    context.beginPath()
    context.moveTo(edge.start.projected.x, edge.start.projected.y)
    context.lineTo(edge.end.projected.x, edge.end.projected.y)
    context.stroke()
  }

  if (!interaction || placed.length <= 20) return
  for (const point of placed.filter((candidate) => candidate.projected.z > 0.3)) {
    context.fillStyle = `rgba(255,255,255,${((point.projected.z - 0.3) / 0.7) * 0.4})`
    context.beginPath()
    context.arc(point.projected.x, point.projected.y, 0.8, 0, TAU)
    context.fill()
  }
}

export function mountHeroSphere(canvas: HTMLCanvasElement) {
  const wrap = canvas.parentElement
  const context = canvas.getContext("2d")
  const complete = STAGE_GEOMETRY.at(-1)
  if (!wrap || !context || !complete) return
  const dpr = window.devicePixelRatio || 1
  let width = 0
  let height = 0
  let rx = 0.3
  let ry = 0
  let targetRx = 0.3
  let targetRy = 0
  let autoRy = 0
  let isDragging = false
  let lastDragX = 0
  let lastDragY = 0
  let dragVx = 0
  let cursor: Cursor | undefined
  let pulses: Pulse[] = []
  let growthComplete = false
  const growthStart = performance.now()

  const resize = () => {
    const rect = wrap.getBoundingClientRect()
    width = rect.width
    height = rect.height
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener("resize", resize)

  const pointer = (source: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect()
    return { x: source.clientX - rect.left, y: source.clientY - rect.top }
  }
  const press = (source: { clientX: number; clientY: number }) => {
    isDragging = true
    const point = pointer(source)
    lastDragX = point.x
    lastDragY = point.y
    dragVx = 0
  }
  const move = (source: { clientX: number; clientY: number }) => {
    const point = pointer(source)
    cursor = point
    if (!isDragging) return
    const dx = point.x - lastDragX
    targetRy += dx * 0.006
    targetRx = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, targetRx + (point.y - lastDragY) * 0.006))
    dragVx = dx
    lastDragX = point.x
    lastDragY = point.y
  }
  const release = () => {
    if (isDragging) {
      targetRy += dragVx * 0.02
      targetRx += dragVx * 0.005
    }
    isDragging = false
  }

  wrap.addEventListener("mousedown", press)
  wrap.addEventListener("mousemove", move)
  wrap.addEventListener("mouseup", release)
  wrap.addEventListener("mouseleave", () => {
    cursor = undefined
    isDragging = false
  })
  wrap.addEventListener("click", (event) => {
    if (!growthComplete) return
    const point = pointer(event)
    const r = Math.min(width, height) * RADIUS_SCALE
    const nx = (point.x - width / 2) / r
    const ny = (point.y - height / 2) / r
    const d2 = nx * nx + ny * ny
    if (d2 > 1) return
    const nz = Math.sqrt(1 - d2)
    const cosY = Math.cos(-ry)
    const sinY = Math.sin(-ry)
    const x2 = nx * cosY + nz * sinY
    const z2 = -nx * sinY + nz * cosY
    const cosX = Math.cos(-rx)
    const sinX = Math.sin(-rx)
    const y2 = ny * cosX - z2 * sinX
    const z3 = ny * sinX + z2 * cosX
    const m = Math.sqrt(x2 * x2 + y2 * y2 + z3 * z3)
    pulses.push({ origin: { x: x2 / m, y: y2 / m, z: z3 / m }, startTime: performance.now() })
  })
  wrap.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches.item(0)
      if (touch) press(touch)
    },
    { passive: true },
  )
  wrap.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches.item(0)
      if (touch) move(touch)
      event.preventDefault()
    },
    { passive: false },
  )
  wrap.addEventListener("touchend", release)

  const frame = (now: number) => {
    const elapsed = now - growthStart
    growthComplete = elapsed >= GROWTH_DURATION
    const growth = growthComplete ? { geometry: complete, scale: 1 } : growingGeometry(elapsed)
    autoRy += 0.0018
    rx += (targetRx - rx) * 0.12
    ry += (targetRy - ry) * 0.12
    pulses = pulses.filter((pulse) => now - pulse.startTime < PULSE_LIFETIME)
    drawSphere(
      context,
      growth.geometry,
      { width, height, rx, ry: ry + autoRy, radius: Math.min(width, height) * RADIUS_SCALE * growth.scale },
      { cursor, pulses, time: now },
    )
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

export function mountStageSphere(canvas: HTMLCanvasElement, level: number) {
  const context = canvas.getContext("2d")
  const sphere = STAGE_GEOMETRY.at(level)
  if (!context || !sphere) return
  const dpr = window.devicePixelRatio || 1
  const render = () => {
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawSphere(context, sphere, {
      width: rect.width,
      height: rect.height,
      rx: 0.35,
      ry: -0.5,
      radius: Math.min(rect.width, rect.height) * RADIUS_SCALE,
    })
  }
  render()
  window.addEventListener("resize", render)
}
