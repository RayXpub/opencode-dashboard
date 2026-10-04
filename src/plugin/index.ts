import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin"
import path from "node:path"
import { createServer } from "../collector/server"
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
  normalizeEvent,
  sanitizeSession,
} from "./normalize"
import { TelemetrySender } from "./sender"

const processInstanceId = crypto.randomUUID()
const HEARTBEAT_INTERVAL_MS = 3_000
const hostname = "127.0.0.1"
const collectorUrl = `http://${hostname}:${DEFAULT_COLLECTOR_PORT}`
const dashboardRoot = import.meta.dir.includes(`${path.sep}src${path.sep}`)
  ? path.resolve(import.meta.dir, "../../dist")
  : path.resolve(import.meta.dir, "..")
let collector: ReturnType<typeof createServer> | undefined

type SessionListClient = Pick<OpenCodeClient["session"], "list">
type SessionWriteClient = Pick<OpenCodeClient["session"], "update" | "remove">

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

function readSessionsPage(value: unknown): { sessions: unknown[]; cursor?: string } {
  if (Array.isArray(value)) return { sessions: value }
  if (typeof value !== "object" || value === null) return { sessions: [] }
  const record = value as { data?: unknown; cursor?: { next?: unknown } }
  return {
    sessions: Array.isArray(record.data) ? record.data : [],
    cursor: typeof record.cursor?.next === "string" ? record.cursor.next : undefined,
  }
}

export async function listGlobalSessions(serverUrl: URL): Promise<unknown[]> {
  const sessions: unknown[] = []
  let cursor: string | undefined

  do {
    const url = new URL("/api/session", serverUrl)
    url.searchParams.set("limit", "100")
    if (cursor) url.searchParams.set("cursor", cursor)
    const response = await fetch(url, { headers: serverAuthHeaders() })
    if (!response.ok) throw new Error(`Global session request failed: ${response.status}`)
    const page = readSessionsPage(await response.json())
    sessions.push(...page.sessions)
    cursor = page.cursor
  } while (cursor)

  return sessions
}

export async function listGlobalSessionsWithClient(
  client: SessionListClient,
): Promise<unknown[]> {
  const sessions: unknown[] = []
  let cursor: string | undefined

  do {
    const page = await client.list({ limit: 100, cursor })
    sessions.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return sessions
}

async function collectorIsAvailable() {
  try {
    const response = await fetch(`${collectorUrl}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return response.ok
  } catch {
    return false
  }
}

async function ensureCollector() {
  if (await collectorIsAvailable()) return

  try {
    collector = createServer({
      hostname,
      port: DEFAULT_COLLECTOR_PORT,
      dashboardRoot,
    })
  } catch (error) {
    if (!(await collectorIsAvailable())) throw error
  }
}

function openDashboard() {
  const url = `${collectorUrl}/?v=${Date.now()}`
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  const subprocess = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  subprocess.unref()
}

export default Plugin.define({
  id: "opencode-dashboard",
  async setup(context) {
    const directory = context.location.directory
    const projectId = context.location.project.id
    const source: SourceIdentity = {
      processInstanceId,
      pluginInstanceId: crypto.randomUUID(),
      projectId: dashboardProjectId(projectId, directory),
      projectName: path.basename(directory) || projectId,
      directory,
      capabilities: ["session.write"],
    }
    const sender = new TelemetrySender({ collectorUrl })
    const sessions = new Map<string, SnapshotSession>()
    const abort = new AbortController()
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
        const client = context.session as unknown as Partial<SessionListClient>
        if (typeof client.list !== "function") return
        const sessionResult = await client.list({ directory })

        for (const info of sessionResult.data) {
          const session = sanitizeSession(info)
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
      } finally {
        localRefreshRunning = false
      }
    }

    async function refreshGlobalSessions() {
      if (disposed || globalRefreshRunning) return
      globalRefreshRunning = true
      try {
        const client = context.session as unknown as Partial<SessionListClient>
        if (typeof client.list !== "function") return
        const globalResult = await listGlobalSessionsWithClient(client as SessionListClient)

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
      scheduleSnapshot(0, refreshLocalSessions)
      scheduleSnapshot(1_000, refreshGlobalSessions)
    }

    async function executeSessionCommand(command: SessionCommand) {
      try {
        const client = context.session as SessionWriteClient
        if (command.action === "session.rename") {
          await client.update({ sessionID: command.sessionId, title: command.title })
        } else {
          await client.remove({ sessionID: command.sessionId })
        }
        await sender.sendCommandResult({ commandId: command.id, ok: true })
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

    async function listenForEvents() {
      try {
        for await (const event of context.event.subscribe({ signal: abort.signal })) {
          const message = normalizeEvent(event, source, sessions)
          if (message) sender.enqueue(message)
        }
      } catch (error) {
        if (!disposed) debug("Event subscription failed", error)
      }
    }

    const commandRegistration = await context.command.transform((editor) => {
      editor.add({
        name: "dashboard",
        description: "Open the OpenCode Dashboard",
        async execute() {
          await ensureCollector()
          await refreshGlobalSessions()
          openDashboard()
        },
      })
    })

    void listenForEvents()
    const initialHeartbeatTimer = setTimeout(reportHeartbeat, 0)
    const heartbeatInterval = setInterval(reportHeartbeat, HEARTBEAT_INTERVAL_MS)

    return async () => {
      disposed = true
      abort.abort()
      clearTimeout(initialHeartbeatTimer)
      for (const timer of snapshotTimers) clearTimeout(timer)
      snapshotTimers.clear()
      clearInterval(heartbeatInterval)
      collector?.stop()
      collector = undefined
      await commandRegistration.dispose()
      await sender.stop()
    }
  },
})
