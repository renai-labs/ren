import { afterAll } from "bun:test"
import { Shared } from "./shared.js"

afterAll(Shared.dispose)
