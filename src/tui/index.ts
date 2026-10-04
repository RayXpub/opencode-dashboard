import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import path from "node:path"
import { createServer } from "../collector/server"
import { sanitizeSession } from "../plugin/normalize"
import { TelemetrySender } from "../plugin/sender"
import {
  DEFAULT_COLLECTOR_PORT,
  type SnapshotSession,
  type SourceIdentity,
} from "../shared/protocol"

const hostname = "127.0.0.1"
const dashboardUrl = `http://${hostname}:${DEFAULT_COLLECTOR_PORT}`
const dashboardRoot = import.meta.dir.includes(`${path.sep}src${path.sep}`)
  ? path.resolve(import.meta.dir, "../../dist")
  : path.resolve(import.meta.dir, "..")
let collector: ReturnType<typeof createServer> | undefined
const sender = new TelemetrySender({ collectorUrl: dashboardUrl })

type SessionListClient = Pick<OpenCodeClient["session"], "list">

async function collectorIsAvailable() {
  try {
    const response = await fetch(`${dashboardUrl}/health`, {
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

export async function listGlobalSessions(client: SessionListClient) {
  const sessions: SnapshotSession[] = []
  let cursor: string | undefined

  do {
    const result = await client.list({ limit: 100, cursor })
    for (const info of result.data) {
      const session = sanitizeSession(info)
      if (session) sessions.push({ ...session, statusKnown: false })
    }
    cursor = result.cursor.next ?? undefined
  } while (cursor)

  return sessions
}

async function sendGlobalSnapshot(client: SessionListClient, source: SourceIdentity) {
  await sender.sendSnapshot({
    source,
    scope: "global",
    sessions: await listGlobalSessions(client),
  })
}

function openDashboard() {
  const url = `${dashboardUrl}/?v=${Date.now()}`
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
  setup(context) {
    if (process.env.OPENCODE_DASHBOARD_DEBUG === "1") {
      console.error("[opencode-dashboard] TUI plugin setup")
    }
    const directory = context.location?.directory ?? process.cwd()
    const source: SourceIdentity = {
      kind: "tui",
      processInstanceId: crypto.randomUUID(),
      pluginInstanceId: crypto.randomUUID(),
      projectId: `tui:${directory}`,
      projectName: path.basename(directory) || "opencode",
      directory,
    }

    let snapshotRunning = false
    async function syncGlobalSessionsIfCollectorIsRunning() {
      if (snapshotRunning || !(await collectorIsAvailable())) return
      snapshotRunning = true
      try {
        await sendGlobalSnapshot(context.client.session, source)
      } catch {
        // Best effort. The dashboard will try again on the next interval.
      } finally {
        snapshotRunning = false
      }
    }

    const initialSnapshotTimer = setTimeout(
      syncGlobalSessionsIfCollectorIsRunning,
      500,
    )
    const snapshotInterval = setInterval(
      syncGlobalSessionsIfCollectorIsRunning,
      3_000,
    )

    const unregisterSlot = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          commands: [
            {
              id: "dashboard.open",
              palette: true,
              slash: { name: "dashboard" },
              title: "Open dashboard",
              group: "Dashboard",
              async run() {
                try {
                  await ensureCollector()
                  await sendGlobalSnapshot(context.client.session, source)
                  openDashboard()
                  context.ui.toast.show({
                    variant: "success",
                    title: "Dashboard",
                    message: `Opened ${dashboardUrl}`,
                  })
                } catch (error) {
                  context.ui.toast.show({
                    variant: "error",
                    title: "Dashboard",
                    message: error instanceof Error ? error.message : String(error),
                  })
                }
              },
            },
          ],
        }))
        return undefined
      },
    })

    return () => {
      clearTimeout(initialSnapshotTimer)
      clearInterval(snapshotInterval)
      unregisterSlot()
      collector?.stop()
      collector = undefined
    }
  },
})
