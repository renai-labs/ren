import { type Layer, LayerDiagram } from "./layer-diagram.js"

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

export function ArchitectureDiagram() {
  return (
    <LayerDiagram
      colors="[--diagram-fg:var(--color-foreground)] [--diagram-muted:var(--color-muted-foreground)]"
      viewBox="0 100 1280 360"
      layers={LAYERS}
      start={{ text: "Company", x: 40 }}
      end={{ text: "Outcome", x: 1170 }}
      arrows={[
        { x1: 125, x2: 200 },
        { x1: 345, x2: 380 },
        { x1: 525, x2: 600 },
        { x1: 715, x2: 840 },
      ]}
      dash={{ x1: 985, x2: 1155 }}
    />
  )
}
