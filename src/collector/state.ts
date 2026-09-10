import type {
  DashboardProcess,
  DashboardProject,
  DashboardSession,
  Heartbeat,
  SessionStatusChanged,
  TelemetryMessage,
  SnapshotRequest,
  SessionStatus,
} from "../shared/protocol"

type StoredProcess = {
  processInstanceId: string
  openCodeVersion?: string
  projectIds: Set<string>
  directories: Set<string>
  pluginInstanceIds: Set<string>
  serverUrl?: string
  capabilities: Set<string>
  lastSeenAt: number
}

type StoredProject = {
  id: string
  name: string
  directories: Set<string>
  sessionCount: number
  lastActivityAt: number
}

type StoredSession = {
  id: string
  parentId?: string
  projectId: string
  directory: string
  processInstanceId?: string
  title: string
  agent?: string
  model?: string
  status: SessionStatus
  updatedAt: number
}

type SseSubscriber = {
  controller: ReadableStreamDefaultController
  encoder: TextEncoder
}

const HEARTBEAT_INTERVAL_MS = 10_000
const STALE_THRESHOLD_MS = 30_000

export const collectorInstanceId = crypto.randomUUID()

let processes = new Map<string, StoredProcess>()
let projects = new Map<string, StoredProject>()
let sessions = new Map<string, StoredSession>()
let subscribers = new Set<SseSubscriber>()
let receivedGlobalSnapshot = false

export function isReconciliationRequired() {
  return !receivedGlobalSnapshot
}

export function handleHeartbeat(message: Heartbeat) {
  const { source } = message
  const existing = processes.get(source.processInstanceId)
  if (existing) {
    existing.lastSeenAt = Date.now()
    existing.pluginInstanceIds.add(source.pluginInstanceId)
    existing.openCodeVersion = source.openCodeVersion
    existing.serverUrl = source.serverUrl
    existing.capabilities = new Set(source.capabilities ?? [])
    existing.projectIds.add(source.projectId)
    existing.directories.add(source.directory)
  } else {
    processes.set(source.processInstanceId, {
      processInstanceId: source.processInstanceId,
      openCodeVersion: source.openCodeVersion,
      projectIds: new Set([source.projectId]),
      directories: new Set([source.directory]),
      pluginInstanceIds: new Set([source.pluginInstanceId]),
      serverUrl: source.serverUrl,
      capabilities: new Set(source.capabilities ?? []),
      lastSeenAt: Date.now(),
    })
  }

  const project = projects.get(source.projectId)
  if (project) {
    project.directories.add(source.directory)
  } else {
    projects.set(source.projectId, {
      id: source.projectId,
      name: source.projectName,
      directories: new Set([source.directory]),
      sessionCount: 0,
      lastActivityAt: Date.now(),
    })
  }

  broadcastEvent({ type: "heartbeat", processInstanceId: source.processInstanceId })
}

export function handleIngest(messages: TelemetryMessage[]) {
  for (const message of messages) {
    switch (message.type) {
      case "heartbeat":
        handleHeartbeat(message)
        break
      case "session.status.changed":
        handleSessionStatusChanged(message)
        break
      case "session.deleted":
        sessions.delete(message.sessionId)
        broadcastEvent({ type: "session.deleted", sessionId: message.sessionId })
        break
    }
  }
}

export function handleSnapshot(request: SnapshotRequest) {
  if (request.scope === "global") receivedGlobalSnapshot = true
  handleHeartbeat({
    protocolVersion: 1,
    type: "heartbeat",
    sentAt: Date.now(),
    source: request.source,
  })

  for (const session of request.sessions) {
    const existing = sessions.get(session.id)
    const projectId = session.projectId ?? request.source.projectId
    const projectName = session.projectName ?? projectId
    const directory = session.directory ?? request.source.directory

    const project = projects.get(projectId)
    if (project) {
      project.directories.add(directory)
      project.lastActivityAt = Math.max(project.lastActivityAt, session.updatedAt)
    } else {
      projects.set(projectId, {
        id: projectId,
        name: projectName,
        directories: new Set([directory]),
        sessionCount: 0,
        lastActivityAt: session.updatedAt,
      })
    }

    if (!existing || session.updatedAt >= existing.updatedAt) {
      sessions.set(session.id, {
        id: session.id,
        parentId: session.parentId,
        projectId,
        directory,
        processInstanceId:
          session.statusKnown === false
            ? existing?.processInstanceId
            : request.source.processInstanceId,
        title: session.title,
        agent: session.agent,
        model: session.model,
        status:
          session.statusKnown === false && existing
            ? existing.status
            : session.status,
        updatedAt: session.updatedAt,
      })
    }
  }

  broadcastEvent({ type: "snapshot", processInstanceId: request.source.processInstanceId })
}

function handleSessionStatusChanged(message: SessionStatusChanged) {
  const { session, source } = message
  const existing = sessions.get(session.id)

  if (existing && session.updatedAt < existing.updatedAt) {
    return
  }

  sessions.set(session.id, {
    id: session.id,
    parentId: session.parentId,
    projectId: source.projectId,
    directory: source.directory,
    processInstanceId: source.processInstanceId,
    title: session.title,
    agent: session.agent,
    model: session.model,
    status: session.status,
    updatedAt: session.updatedAt,
  })

  const project = projects.get(source.projectId)
  if (project) {
    project.lastActivityAt = Date.now()
  }

  broadcastEvent({ type: "session.updated", sessionId: session.id })
}

export function getSessionActionTarget(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const now = Date.now()
  const executorAvailable = [...processes.values()].some(
    (process) =>
      process.capabilities.has("session.write") &&
      now - process.lastSeenAt <= STALE_THRESHOLD_MS,
  )
  if (!executorAvailable) return
  return { directory: session.directory }
}

export function applySessionRename(sessionId: string, title: string) {
  const session = sessions.get(sessionId)
  if (!session) return false

  session.title = title
  session.updatedAt = Date.now()
  broadcastEvent({ type: "session.updated", sessionId })
  return true
}

export function applySessionDelete(sessionId: string) {
  if (!sessions.has(sessionId)) return false

  const pending = [sessionId]
  const deleted = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (deleted.has(current)) continue
    deleted.add(current)
    for (const session of sessions.values()) {
      if (session.parentId === current) pending.push(session.id)
    }
  }

  for (const id of deleted) sessions.delete(id)
  broadcastEvent({ type: "session.deleted", sessionId })
  return true
}

export function getState() {
  markStaleProcesses()

  const resultProcesses: DashboardProcess[] = []
  for (const [, p] of processes) {
    const stale = Date.now() - p.lastSeenAt > STALE_THRESHOLD_MS
    resultProcesses.push({
      processInstanceId: p.processInstanceId,
      openCodeVersion: p.openCodeVersion,
      projects: [...p.projectIds],
      lastSeenAt: p.lastSeenAt,
      stale,
    })
  }

  const resultProjects: DashboardProject[] = []
  for (const [, p] of projects) {
    const projectSessionCount = [...sessions.values()].filter(
      (s) => s.projectId === p.id,
    ).length
    if (projectSessionCount === 0) continue

    resultProjects.push({
      id: p.id,
      name: p.name,
      directories: [...p.directories],
      sessionCount: projectSessionCount,
      lastActivityAt: p.lastActivityAt,
    })
  }

  const resultSessions: DashboardSession[] = []
  for (const [, s] of sessions) {
    const process = s.processInstanceId
      ? processes.get(s.processInstanceId)
      : undefined
    const processStale = process
      ? Date.now() - process.lastSeenAt > STALE_THRESHOLD_MS
      : false
    const wasActive = ["running", "waiting", "retrying"].includes(s.status)
    resultSessions.push({
      id: s.id,
      parentId: s.parentId,
      projectId: s.projectId,
      directory: s.directory,
      title: s.title,
      agent: s.agent,
      model: s.model,
      status: processStale && wasActive ? "stale" : s.status,
      updatedAt: s.updatedAt,
    })
  }

  return {
    ready: receivedGlobalSnapshot,
    processes: resultProcesses,
    projects: resultProjects,
    sessions: resultSessions,
  }
}

function markStaleProcesses() {}

function broadcastEvent(event: Record<string, unknown>) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const sub of subscribers) {
    try {
      sub.controller.enqueue(sub.encoder.encode(data))
    } catch {
      subscribers.delete(sub)
    }
  }
}

export function subscribeToEvents(req: Request): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const sub: SseSubscriber = { controller, encoder }
      subscribers.add(sub)

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`),
      )

      const interval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`),
          )
        } catch {
          subscribers.delete(sub)
          clearInterval(interval)
        }
      }, HEARTBEAT_INTERVAL_MS)

      req.signal.addEventListener("abort", () => {
        subscribers.delete(sub)
        clearInterval(interval)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
