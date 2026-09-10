import {
  applySessionDelete,
  applySessionRename,
  collectorInstanceId,
  getSessionActionTarget,
  getState,
  handleHeartbeat,
  handleIngest,
  handleSnapshot,
  isReconciliationRequired,
  subscribeToEvents,
} from "./state"
import {
  claimSessionCommands,
  completeSessionCommand,
  enqueueSessionCommand,
} from "./commands"
import { ingestRequestSchema, snapshotRequestSchema, heartbeatSchema } from "../shared/telemetry"
import { z } from "zod"

const renameSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
})
const commandResultSchema = z.object({
  commandId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
})

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return !origin || origin === new URL(request.url).origin
}

async function mutateOpenCodeSession(
  method: "PATCH" | "DELETE",
  sessionId: string,
  title?: string,
) {
  const target = getSessionActionTarget(sessionId)
  if (!target) {
    return Response.json(
      {
        error:
          "No compatible OpenCode server is available. Restart one OpenCode session to load the latest dashboard plugin, then try again.",
      },
      { status: 503 },
    )
  }

  const result = await enqueueSessionCommand({
    action: method === "PATCH" ? "session.rename" : "session.delete",
    sessionId,
    directory: target.directory,
    title,
  })
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 })
  }

  if (method === "PATCH") applySessionRename(sessionId, title!)
  else applySessionDelete(sessionId)
  return Response.json({ ok: true })
}

type CollectorConfig = {
  hostname: string
  port: number
  dashboard: any
}

export function createServer(config: CollectorConfig) {
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,

    routes: {
      "/": config.dashboard,
      "/health": {
        GET() {
          return Response.json({ status: "ok", collectorInstanceId })
        },
      },
      "/api/v1/ingest": {
        async POST(req) {
          const body = await req.json()
          const parsed = ingestRequestSchema.safeParse(body)
          if (!parsed.success) {
            return Response.json(
              { error: "Invalid ingest request", details: parsed.error.issues },
              { status: 400 },
            )
          }
          handleIngest(parsed.data.messages)
          return Response.json({ ok: true })
        },
      },
      "/api/v1/snapshot": {
        async POST(req) {
          const body = await req.json()
          const parsed = snapshotRequestSchema.safeParse(body)
          if (!parsed.success) {
            return Response.json(
              { error: "Invalid snapshot request", details: parsed.error.issues },
              { status: 400 },
            )
          }
          handleSnapshot(parsed.data)
          return Response.json({ ok: true })
        },
      },
      "/api/v1/heartbeat": {
        async POST(req) {
          const body = await req.json()
          const parsed = heartbeatSchema.safeParse(body)
          if (!parsed.success) {
            return Response.json(
              { error: "Invalid heartbeat", details: parsed.error.issues },
              { status: 400 },
            )
          }
          handleHeartbeat(parsed.data)
          const reconcileRequired = isReconciliationRequired()
          const commands = parsed.data.source.capabilities?.includes("session.write")
            ? claimSessionCommands()
            : []
          return Response.json({
            ok: true,
            collectorInstanceId: reconcileRequired
              ? `${collectorInstanceId}:reconcile`
              : collectorInstanceId,
            reconcileRequired,
            commands,
          })
        },
      },
      "/api/v1/commands/:id/result": {
        async POST(req) {
          const parsed = commandResultSchema.safeParse(await req.json())
          if (!parsed.success || parsed.data.commandId !== req.params.id) {
            return Response.json({ error: "Invalid command result" }, { status: 400 })
          }
          if (!completeSessionCommand(parsed.data)) {
            return Response.json({ error: "Command is no longer pending" }, { status: 404 })
          }
          return Response.json({ ok: true })
        },
      },
      "/api/v1/state": {
        GET() {
          return Response.json(getState(), {
            headers: { "Cache-Control": "no-store" },
          })
        },
      },
      "/api/v1/events": {
        GET(req) {
          return subscribeToEvents(req)
        },
      },
      "/api/v1/sessions/:id": {
        async PATCH(req) {
          if (!isAllowedOrigin(req)) {
            return Response.json({ error: "Origin not allowed" }, { status: 403 })
          }
          const parsed = renameSessionSchema.safeParse(await req.json())
          if (!parsed.success) {
            return Response.json({ error: "Title must be 1-200 characters" }, { status: 400 })
          }
          return mutateOpenCodeSession("PATCH", req.params.id, parsed.data.title)
        },
        async DELETE(req) {
          if (!isAllowedOrigin(req)) {
            return Response.json({ error: "Origin not allowed" }, { status: 403 })
          }
          return mutateOpenCodeSession("DELETE", req.params.id)
        },
      },
    },

    development: {
      hmr: true,
      console: true,
    },
  })

  console.log(`OpenCode Dashboard: http://${config.hostname}:${config.port}`)
  return server
}
