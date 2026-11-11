import { afterAll } from "bun:test"
import { Shared } from "@ren/cell/testing"

afterAll(Shared.dispose)
