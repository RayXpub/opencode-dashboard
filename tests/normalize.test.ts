import { describe, expect, test } from "bun:test"
import type { SnapshotSession, SourceIdentity } from "../src/shared/protocol"
import {
  dashboardProjectId,
  mapSessionStatus,
  normalizeEvent,
  sanitizeSession,
} from "../src/plugin/normalize"

const source: SourceIdentity = {
  processInstanceId: "process-1",
  pluginInstanceId: "plugin-1",
  projectId: "project-1",
  projectName: "dashboard",
  directory: "/tmp/dashboard",
}

describe("sanitizeSession", () => {
  test("keeps metadata and drops sensitive or unknown fields", () => {
    const session = sanitizeSession({
      id: "session-12345678",
      parentID: "parent-1",
      title: "Build dashboard",
      agent: "general",
      model: { providerID: "openai", id: "gpt-test" },
      prompt: "private prompt",
      output: "private model output",
      time: { updated: 1234 },
    })

    expect(session).toEqual({
      id: "session-12345678",
      parentId: "parent-1",
      title: "Build dashboard",
      agent: "general",
      model: "openai/gpt-test",
      status: "idle",
      updatedAt: 1234,
    })
    expect(JSON.stringify(session)).not.toContain("private")
  })
})

test("creates distinct dashboard project IDs for shared OpenCode project IDs", () => {
  expect(dashboardProjectId("global", "/projects/control-plane")).not.toBe(
    dashboardProjectId("global", "/projects/dashboard"),
  )
})

describe("mapSessionStatus", () => {
  test("maps OpenCode statuses to dashboard statuses", () => {
    expect(mapSessionStatus({ type: "busy" })).toBe("running")
    expect(mapSessionStatus({ type: "retry" })).toBe("retrying")
    expect(mapSessionStatus({ type: "idle" })).toBe("idle")
  })
})

describe("normalizeEvent", () => {
  test("creates metadata from a session event", () => {
    const sessions = new Map<string, SnapshotSession>()
    const message = normalizeEvent(
      {
        type: "session.created",
        properties: {
          info: {
            id: "session-1",
            title: "New session",
            time: { updated: 2000 },
          },
        },
      },
      source,
      sessions,
    )

    expect(message?.type).toBe("session.status.changed")
    expect(sessions.get("session-1")?.title).toBe("New session")
  })

  test("applies status-only events to cached metadata", () => {
    const sessions = new Map<string, SnapshotSession>([
      [
        "session-1",
        {
          id: "session-1",
          title: "Existing session",
          status: "idle",
          updatedAt: 1000,
        },
      ],
    ])

    const message = normalizeEvent(
      {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "busy" } },
      },
      source,
      sessions,
    )

    expect(message).toMatchObject({
      type: "session.status.changed",
      session: { id: "session-1", title: "Existing session", status: "running" },
    })
  })

  test("removes deleted sessions", () => {
    const sessions = new Map<string, SnapshotSession>([
      [
        "session-1",
        { id: "session-1", title: "Old session", status: "idle", updatedAt: 1 },
      ],
    ])

    const message = normalizeEvent(
      {
        type: "session.deleted",
        properties: { info: { id: "session-1" } },
      },
      source,
      sessions,
    )

    expect(message).toMatchObject({ type: "session.deleted", sessionId: "session-1" })
    expect(sessions.has("session-1")).toBeFalse()
  })

  test("adds agent metadata from message events without forwarding content", () => {
    const sessions = new Map<string, SnapshotSession>()
    const message = normalizeEvent(
      {
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          info: {
            sessionID: "session-1",
            agent: "explore",
            model: { providerID: "openai", modelID: "gpt-test" },
            system: "private system prompt",
          },
        },
      },
      source,
      sessions,
    )

    expect(message).toMatchObject({
      type: "session.status.changed",
      session: {
        id: "session-1",
        agent: "explore",
        model: "openai/gpt-test",
      },
    })
    expect(JSON.stringify(message)).not.toContain("private system prompt")
  })

  test("updates the active agent when OpenCode switches agents", () => {
    const sessions = new Map<string, SnapshotSession>()
    const message = normalizeEvent(
      {
        type: "session.next.agent.switched",
        properties: { sessionID: "session-1", agent: "general" },
      },
      source,
      sessions,
    )

    expect(message).toMatchObject({
      type: "session.status.changed",
      session: { agent: "general" },
    })
  })
})
