import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { chooseSidebarLook, useSidebarLook, type SidebarLook } from "@/stores/ui"

const looks: ReadonlyArray<{ value: SidebarLook; label: string }> = [
  { value: "classic", label: "Current" },
  { value: "notion", label: "Notion" },
  { value: "devin", label: "Devin" },
  { value: "cursor", label: "Cursor" },
]

const isLook = (value: unknown): value is SidebarLook => looks.some((look) => look.value === value)

export function SidebarLookSwitcher() {
  const look = useSidebarLook()
  return (
    <Tabs
      value={look}
      onValueChange={(value) => {
        if (isLook(value)) chooseSidebarLook(value)
      }}
      className="fixed top-2.5 left-1/2 z-50 -translate-x-1/2 max-md:hidden"
    >
      <TabsList className="shadow-overlay">
        <span className="px-2 text-xs">Sidebar</span>
        {looks.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="px-2.5 text-xs">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
