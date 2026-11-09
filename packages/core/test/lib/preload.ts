import { afterAll } from "bun:test"
import { Shared } from "@ren/brain-runtime/testing"

afterAll(Shared.dispose)
