import {
  PROTOCOL_VERSION,
  type SessionStatus,
  type SnapshotSession,
  type SourceIdentity,
  type TelemetryMessage,
} from "../shared/protocol"

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as UnknownRecord
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readSessionId(properties: UnknownRecord): string | undefined {
  const direct = optionalString(properties.sessionID)
  if (direct) return direct

  const permission = asRecord(properties.permission)
  if (permission) return optionalString(permission.sessionID)

  const question = asRecord(properties.question)
  return question ? optionalString(question.sessionID) : undefined
}

function readModel(value: unknown): string | undefined {
  const direct = optionalString(value)
  if (direct) return direct

  const model = asRecord(value)
  if (!model) return undefined

  const providerId = optionalString(model.providerID)
  const modelId = optionalString(model.modelID) ?? optionalString(model.id)
  if (providerId && modelId) return `${providerId}/${modelId}`
  return modelId
}

function projectNameFromDirectory(directory: string | undefined): string | undefined {
  if (!directory) return undefined
  return directory.replace(/\/$/, "").split("/").pop() || directory
}

export function dashboardProjectId(
  projectId: string,
  directory: string,
): string {
  return `${projectId}:${directory}`
}

export function mapSessionStatus(rawStatus: unknown): SessionStatus {
  const status = asRecord(rawStatus)
  switch (status?.type) {
    case "busy":
      return "running"
    case "retry":
      return "retrying"
    case "idle":
    default:
      return "idle"
  }
}

export function sanitizeSession(
  value: unknown,
  status: SessionStatus = "idle",
): SnapshotSession | null {
  const session = asRecord(value)
  const id = optionalString(session?.id)
  if (!session || !id) return null

  const time = asRecord(session.time)
  const project = asRecord(session.project)
  const directory = optionalString(session.directory)
  const projectId = optionalString(session.projectID)
  return {
    id,
    parentId: optionalString(session.parentID),
    projectId:
      projectId && directory
        ? dashboardProjectId(projectId, directory)
        : projectId,
    projectName:
      optionalString(project?.name) ?? projectNameFromDirectory(directory),
    directory,
    title: optionalString(session.title) ?? `Session ${id.slice(-8)}`,
    agent: optionalString(session.agent),
    model: readModel(session.model),
    status,
    updatedAt:
      typeof time?.updated === "number" ? time.updated : Date.now(),
  }
}

function statusMessage(
  source: SourceIdentity,
  session: SnapshotSession,
): TelemetryMessage {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "session.status.changed",
    sentAt: Date.now(),
    source,
    session,
  }
}

function updateSessionAgent(
  properties: UnknownRecord,
  sessions: Map<string, SnapshotSession>,
  status?: SessionStatus,
): SnapshotSession | null {
  const info = asRecord(properties.info)
  const sessionId = readSessionId(properties) ?? optionalString(info?.sessionID)
  if (!sessionId) return null

  const previous = sessions.get(sessionId) ?? {
    id: sessionId,
    title: `Session ${sessionId.slice(-8)}`,
    status: "idle" as const,
    updatedAt: Date.now(),
  }
  const agent = optionalString(properties.agent) ?? optionalString(info?.agent)
  const model = readModel(properties.model) ?? readModel(info?.model)
  const session = {
    ...previous,
    agent: agent ?? previous.agent,
    model: model ?? previous.model,
    status: status ?? previous.status,
    updatedAt: Date.now(),
  }
  sessions.set(sessionId, session)
  return session
}

export function normalizeEvent(
  value: unknown,
  source: SourceIdentity,
  sessions: Map<string, SnapshotSession>,
): TelemetryMessage | null {
  const event = asRecord(value)
  const type = optionalString(event?.type)
  const properties = asRecord(event?.properties)
  if (!type || !properties) return null

  if (type === "session.created" || type === "session.updated") {
    const info = asRecord(properties.info)
    const id = optionalString(info?.id)
    const previous = id ? sessions.get(id) : undefined
    const session = sanitizeSession(info, previous?.status ?? "idle")
    if (!session) return null
    sessions.set(session.id, session)
    return statusMessage(source, session)
  }

  if (type === "session.deleted") {
    const info = asRecord(properties.info)
    const sessionId = optionalString(info?.id)
    if (!sessionId) return null
    sessions.delete(sessionId)
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "session.deleted",
      sentAt: Date.now(),
      source,
      sessionId,
    }
  }

  if (
    type === "message.updated" ||
    type === "session.next.agent.switched" ||
    type === "session.next.model.switched" ||
    type === "session.next.step.started"
  ) {
    const session = updateSessionAgent(
      properties,
      sessions,
      type === "session.next.step.started" ? "running" : undefined,
    )
    return session ? statusMessage(source, session) : null
  }

  const sessionId = readSessionId(properties)
  if (!sessionId) return null

  const previous = sessions.get(sessionId) ?? {
    id: sessionId,
    title: `Session ${sessionId.slice(-8)}`,
    status: "idle" as const,
    updatedAt: Date.now(),
  }

  let status: SessionStatus
  switch (type) {
    case "session.status":
      status = mapSessionStatus(properties.status)
      break
    case "session.idle":
      status = "idle"
      break
    case "session.error":
      status = "failed"
      break
    case "permission.asked":
    case "permission.updated":
    case "question.asked":
      status = "waiting"
      break
    default:
      return null
  }

  const session = { ...previous, status, updatedAt: Date.now() }
  sessions.set(sessionId, session)
  return statusMessage(source, session)
}
