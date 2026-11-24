import { Suspense, useState, type ReactElement, type ReactNode } from "react"
import { IconPlus } from "@tabler/icons-react"
import { Checkbox } from "@ren/ui/checkbox"
import { ColorDot } from "@ren/ui/color-dot"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Spinner } from "@ren/ui/spinner"
import { labelColor } from "./task-meta.js"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"
import { useLabels } from "../lib/use-labels.js"

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function LabelOptions(props: {
  value: ReadonlyArray<string>
  spaceId: string | undefined
  onChange: (names: string[]) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const labels = useLabels(props.spaceId)
  const create = useMutation(api.label.create.mutationOptions())
  const [query, setQuery] = useState("")
  const typed = query.trim()
  const creatable = typed !== "" && !labels.some((label) => same(label.name, typed))
  const chosen = (name: string) => props.value.some((each) => same(each, name))
  const toggle = (name: string) =>
    props.onChange(chosen(name) ? props.value.filter((each) => !same(each, name)) : [...props.value, name])
  const add = (name: string) =>
    create.mutate(
      { ...(props.spaceId && { spaceId: props.spaceId }), name },
      {
        onSuccess: (label) => {
          props.onChange([...props.value, label.name])
          setQuery("")
        },
        onError: (error) => toast.error("Couldn’t create the label", { description: errorMessage(error) }),
      },
    )
  return (
    <Command label="Labels">
      <CommandInput placeholder="Search or create labels…" value={query} onValueChange={setQuery} />
      <CommandList className="pt-1">
        {creatable ? null : <CommandEmpty>No labels match.</CommandEmpty>}
        <CommandGroup className="p-0">
          {labels.map((label) => (
            <CommandItem
              key={label.id}
              value={label.name}
              onSelect={() => toggle(label.name)}
              className="[&>svg:last-child]:hidden"
            >
              <ColorDot color={labelColor(label.color, label.name)} />
              <span className="min-w-0 flex-1 truncate">
                {label.name}
                {chosen(label.name) ? <span className="sr-only">, selected</span> : null}
              </span>
              <Checkbox
                checked={chosen(label.name)}
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none data-checked:border-chart-1 data-checked:bg-chart-1 data-checked:text-white dark:data-checked:bg-chart-1"
              />
            </CommandItem>
          ))}
          {creatable ? (
            <CommandItem
              value={`create ${typed}`}
              disabled={create.isPending}
              onSelect={() => add(typed)}
              className="[&>svg:last-child]:hidden"
            >
              {create.isPending ? <Spinner /> : <IconPlus className="text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">
                Create <span className="font-medium">“{typed}”</span>
              </span>
            </CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function LabelPicker(props: {
  value: ReadonlyArray<string>
  spaceId: string | undefined
  trigger: ReactElement
  children: ReactNode
  onChange: (names: string[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger render={props.trigger}>{props.children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1">
        <Suspense fallback={<Spinner className="m-4 self-center" />}>
          <LabelOptions value={props.value} spaceId={props.spaceId} onChange={props.onChange} />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
