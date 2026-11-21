import { IconChevronDown, IconFolder, IconGitBranch } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { WorkspaceProject } from "./workspace-project.js"

export function ProjectPicker(props: { projects: WorkspaceProject.Projects }) {
  const projects = props.projects
  const options = [{ path: "" }, ...projects.list.filter((project) => project.path)]
  if (options.length === 1) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1.5 min-w-0 justify-start gap-1 px-1.5 font-normal text-muted-foreground"
            aria-label={`Project: ${WorkspaceProject.projectName(projects.current)}`}
          />
        }
      >
        <span className="truncate">{WorkspaceProject.projectName(projects.current)}</span>
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={projects.current} onValueChange={(value: string) => projects.choose(value)}>
            {options.map((project) => (
              <DropdownMenuRadioItem key={project.path} value={project.path}>
                {project.path ? <IconGitBranch /> : <IconFolder />}
                <span className="min-w-0 flex-1 truncate">{WorkspaceProject.projectName(project.path)}</span>
                {"branch" in project && project.branch ? (
                  <span className="max-w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
                    {project.branch}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
