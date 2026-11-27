import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@ren/ui/code-block"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Textarea } from "@ren/ui/textarea"
import { RouterContext } from "../../lib/router-context.js"
import { useSpaces } from "../../lib/use-spaces.js"

const prompt = `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`

const promptBlock = (
  <CodeBlock size="sm">
    <CodeBlockHeader>
      <CodeBlockTitle>Prompt</CodeBlockTitle>
      <CodeBlockActions>
        <CodeBlockCopyButton value={prompt} />
      </CodeBlockActions>
    </CodeBlockHeader>
    <CodeBlockContent wrap className="max-h-48">
      {prompt}
    </CodeBlockContent>
  </CodeBlock>
)

export function ImportMemoryDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api, platform } = RouterContext.useRouterContext()
  const space = useSpaces().joined.find((joined) => joined.kind === "private")
  const complete = useMutation(api.onboarding.complete.mutationOptions())
  const [content, setContent] = useState("")
  const [problem, setProblem] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) setProblem("")
        props.onOpenChange(next)
      }}
    >
      <DialogContent initialFocus={field} className="sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            setProblem("")
            if (content.trim() === "") {
              setProblem("Paste the results from your other AI assistant first.")
              field.current?.focus()
              return
            }
            if (!space) {
              setProblem("Ren adds memory to your personal space, and you don’t have one.")
              return
            }
            const search = new URLSearchParams({
              prompt: `Save this to my memory:\n\n${content.trim()}`,
              spaceId: space.id,
            })
            platform.openExternal(`${platform.appUrl}/?${search.toString()}`)
            complete.mutate({ step: "memory.imported" })
            setContent("")
            props.onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Import memory</DialogTitle>
            <DialogDescription>Bring what ChatGPT or Claude knows about you into Ren.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>1. Copy this prompt into a chat with your other AI assistant</FieldLabel>
              {promptBlock}
            </Field>
            <Field data-invalid={problem !== "" || undefined}>
              <FieldLabel htmlFor="import-memory-content">2. Paste the results to add them to your memory</FieldLabel>
              <FieldDescription>Ren saves them to your memory in a new chat.</FieldDescription>
              <Textarea
                ref={field}
                id="import-memory-content"
                name="content"
                value={content}
                placeholder="[2025-03-14] - Prefers short answers with the code first."
                className="max-h-60 min-h-32"
                aria-invalid={problem === "" ? undefined : true}
                aria-describedby={problem === "" ? undefined : "import-memory-error"}
                onChange={(event) => setContent(event.target.value)}
              />
              {problem ? <FieldError id="import-memory-error">{problem}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">Add to memory</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
