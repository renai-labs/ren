export type HealthStatus = "ok"

export type HealthInfo = { status: HealthStatus; version: string }

export type HealthGetOutput = HealthInfo
