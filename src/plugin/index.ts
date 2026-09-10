import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import {
  DEFAULT_COLLECTOR_PORT,
  PROTOCOL_VERSION,
  type Heartbeat,
  type SessionCommand,
  type SnapshotSession,
  type SourceIdentity,
} from "../shared/protocol"
import {
  dashboardProjectId,
  mapSessionStatus,
  normalizeEvent,
  sanitizeSession,
} from "./normalize"
import { TelemetrySender } from "./sender"

const processInstanceId = crypto.randomUUID()
const HEARTBEAT_INTERVAL_MS = 3_000

function debug(message: string, error?: unknown) {
  if (process.env.OPENCODE_DASHBOARD_DEBUG !== "1") return
  console.error(`[opencode-dashboard] ${message}`, error ?? "")
}

function serverAuthHeaders(): HeadersInit | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` }
}

async function listGlobalSessions(serverUrl: URL): Promise<unknown[]> {
  const sessions: unknown[] = []
  let cursor: string | undefined

  do {
    const url = new URL("/experimental/session", serverUrl)
    url.searchParams.set("limit", "100")
    if (cursor) url.searchParams.set("cursor", cursor)
    const response = await fetch(url, { headers: serverAuthHeaders() })
    if (!response.ok) throw new Error(`Global session request failed: ${response.status}`)
    const page = await response.json()
    if (!Array.isArray(page)) break
    sessions.push(...page)
    cursor = response.headers.get("x-next-cursor") ?? undefined
  } while (cursor)

  return sessions
}

export default (async ({ client, project, directory, serverUrl }) => {
  const transport = (
    client as unknown as {
      _client: {
        get(options: {
          url: string
          query: { limit: number; cursor?: number }
        }): Promise<{ data?: unknown; error?: unknown; response: Response }>
      }
    }
  )._client
  const source: SourceIdentity = {
    processInstanceId,
    pluginInstanceId: crypto.randomUUID(),
    projectId: dashboardProjectId(project.id, directory),
    projectName: path.basename(directory) || project.id,
    directory,
    serverUrl: serverUrl.toString(),
    capabilities: ["session.write"],
  }
  const collectorUrl = `http://127.0.0.1:${DEFAULT_COLLECTOR_PORT}`
  const sender = new TelemetrySender({ collectorUrl })
  const sessions = new Map<string, SnapshotSession>()
  let disposed = false
  let localRefreshRunning = false
  let globalRefreshRunning = false
  let heartbeatRunning = false
  let collectorConnected = false
  let collectorInstanceId: string | undefined
  const snapshotTimers = new Set<ReturnType<typeof setTimeout>>()

  const heartbeat = (): Heartbeat => ({
    protocolVersion: PROTOCOL_VERSION,
    type: "heartbeat",
    sentAt: Date.now(),
    source,
  })

  sender.start()

  async function refreshLocalSessions() {
    if (disposed || localRefreshRunning) return
    localRefreshRunning = true
    try {
      const [sessionResult, statusResult] = await Promise.all([
        client.session.list(),
        client.session.status(),
      ])
      const statuses = statusResult.data ?? {}

      for (const info of sessionResult.data ?? []) {
        const session = sanitizeSession(
          info,
          mapSessionStatus(statuses[info.id]),
        )
        const existing = session ? sessions.get(session.id) : undefined
        if (session && (!existing || session.updatedAt >= existing.updatedAt)) {
          sessions.set(session.id, { ...session, statusKnown: true })
        }
      }

      if (disposed) return
      await sender.sendSnapshot({
        source,
        scope: "local",
        sessions: [...sessions.values()],
      })
    } catch (error) {
      debug("Local session snapshot failed", error)
      // Monitoring must never prevent OpenCode from starting.
    } finally {
      localRefreshRunning = false
    }
  }

  async function refreshGlobalSessions() {
    if (disposed || globalRefreshRunning) return
    globalRefreshRunning = true
    try {
      let globalResult: unknown[]
      try {
        globalResult = await listGlobalSessions(serverUrl)
      } catch {
        const result = await transport.get({
          url: "/experimental/session",
          query: { limit: 100 },
        })
        if (result.error || !Array.isArray(result.data)) {
          throw new Error("Global session request failed")
        }
        globalResult = result.data
      }

      for (const info of globalResult) {
        const session = sanitizeSession(info)
        const existing = session ? sessions.get(session.id) : undefined
        if (session && (!existing || session.updatedAt >= existing.updatedAt)) {
          sessions.set(session.id, { ...session, statusKnown: false })
        }
      }

      if (!disposed) {
        await sender.sendSnapshot({
          source,
          scope: "global",
          sessions: [...sessions.values()],
        })
      }
    } catch (error) {
      debug("Global session snapshot failed", error)
      // Global discovery is best-effort on OpenCode versions without this API.
    } finally {
      globalRefreshRunning = false
    }
  }

  function scheduleSnapshot(delay: number, refresh: () => Promise<void>) {
    const timer = setTimeout(() => {
      snapshotTimers.delete(timer)
      void refresh()
    }, delay)
    snapshotTimers.add(timer)
  }

  function reconcileCollectorState() {
    // Neither API is queried until plugin registration has completed.
    scheduleSnapshot(0, refreshLocalSessions)
    // The OpenCode HTTP listener may still be starting on initial registration.
    scheduleSnapshot(1_000, refreshGlobalSessions)
  }

  async function executeSessionCommand(command: SessionCommand) {
    const headers = {
      "x-opencode-directory": encodeURIComponent(command.directory),
    }

    try {
      const result =
        command.action === "session.rename"
          ? await client.session.update({
              path: { id: command.sessionId },
              body: { title: command.title },
              headers,
            })
          : await client.session.delete({
              path: { id: command.sessionId },
              headers,
            })
      await sender.sendCommandResult({
        commandId: command.id,
        ok: !result.error,
        error: result.error
          ? `OpenCode rejected the request (${result.response.status})`
          : undefined,
      })
    } catch {
      await sender.sendCommandResult({
        commandId: command.id,
        ok: false,
        error: "OpenCode could not execute the session action",
      })
    }
  }

  async function reportHeartbeat() {
    if (disposed || heartbeatRunning) return
    heartbeatRunning = true

    try {
      const response = await sender.sendHeartbeat(heartbeat())
      const shouldReconcile =
        !collectorConnected ||
        collectorInstanceId !== response.collectorInstanceId ||
        response.reconcileRequired
      collectorConnected = true
      collectorInstanceId = response.collectorInstanceId
      if (shouldReconcile) reconcileCollectorState()
      for (const command of response.commands ?? []) {
        await executeSessionCommand(command)
      }
    } catch {
      collectorConnected = false
    } finally {
      heartbeatRunning = false
    }
  }

  const initialHeartbeatTimer = setTimeout(reportHeartbeat, 0)
  const heartbeatInterval = setInterval(reportHeartbeat, HEARTBEAT_INTERVAL_MS)

  return {
    event: async ({ event }) => {
      const message = normalizeEvent(event, source, sessions)
      if (message) sender.enqueue(message)
    },
    dispose: async () => {
      disposed = true
      clearTimeout(initialHeartbeatTimer)
      for (const timer of snapshotTimers) clearTimeout(timer)
      snapshotTimers.clear()
      clearInterval(heartbeatInterval)
      await sender.stop()
    },
  }
}) satisfies Plugin
