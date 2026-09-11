export const PROTOCOL_VERSION = 1

export const DEFAULT_COLLECTOR_PORT = 4747

export type SourceIdentity = {
  kind?: "server" | "tui"
  processInstanceId: string
  pluginInstanceId: string
  projectId: string
  projectName: string
  directory: string
  serverUrl?: string
  capabilities?: Array<"session.write">
  openCodeVersion?: string
}

export type SessionCommand = {
  id: string
  action: "session.rename" | "session.delete"
  sessionId: string
  directory: string
  title?: string
}

export type SessionCommandResult = {
  commandId: string
  ok: boolean
  error?: string
}

export type Heartbeat = {
  protocolVersion: typeof PROTOCOL_VERSION
  type: "heartbeat"
  sentAt: number
  source: SourceIdentity
}

export type HeartbeatResponse = {
  ok: true
  collectorInstanceId: string
  reconcileRequired: boolean
  commands: SessionCommand[]
}

export type SessionStatus =
  | "running"
  | "waiting"
  | "retrying"
  | "idle"
  | "failed"
  | "stale"

export type SessionStatusChanged = {
  protocolVersion: typeof PROTOCOL_VERSION
  type: "session.status.changed"
  sentAt: number
  source: SourceIdentity
  session: {
    id: string
    parentId?: string
    title: string
    agent?: string
    model?: string
    status: SessionStatus
    updatedAt: number
  }
}

export type SessionDeleted = {
  protocolVersion: typeof PROTOCOL_VERSION
  type: "session.deleted"
  sentAt: number
  source: SourceIdentity
  sessionId: string
}

export type TelemetryMessage = Heartbeat | SessionStatusChanged | SessionDeleted

export type IngestRequest = {
  messages: TelemetryMessage[]
}

export type SnapshotRequest = {
  source: SourceIdentity
  scope: "local" | "global"
  sessions: SnapshotSession[]
}

export type SnapshotSession = {
  id: string
  parentId?: string
  projectId?: string
  projectName?: string
  directory?: string
  title: string
  agent?: string
  model?: string
  status: SessionStatus
  statusKnown?: boolean
  updatedAt: number
}

export type DashboardState = {
  ready: boolean
  processes: DashboardProcess[]
  projects: DashboardProject[]
  sessions: DashboardSession[]
}

export type DashboardProcess = {
  processInstanceId: string
  openCodeVersion?: string
  projects: string[]
  lastSeenAt: number
  stale: boolean
}

export type DashboardProject = {
  id: string
  name: string
  directories: string[]
  sessionCount: number
  lastActivityAt: number
}

export type DashboardSession = {
  id: string
  parentId?: string
  projectId: string
  directory: string
  title: string
  agent?: string
  model?: string
  status: SessionStatus
  updatedAt: number
}
