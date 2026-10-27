import { glob } from "astro/loaders"
import { defineCollection } from "astro:content"
import { z } from "astro/zod"

export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string().optional(),
      hero: z.boolean().default(false),
    }),
  }),
}
