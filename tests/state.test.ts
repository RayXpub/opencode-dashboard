import { expect, test } from "bun:test"
import {
  applySessionDelete,
  applySessionRename,
  getState,
  getSessionActionTarget,
  handleHeartbeat,
  handleIngest,
  handleSnapshot,
} from "../src/collector/state"
import { PROTOCOL_VERSION, type SourceIdentity } from "../src/shared/protocol"

const source: SourceIdentity = {
  processInstanceId: "state-test-process",
  pluginInstanceId: "state-test-plugin",
  projectId: "dashboard-project",
  projectName: "opencode-dashboard",
  directory: "/projects/opencode-dashboard",
}

test("does not expose projects without sessions", () => {
  handleHeartbeat({
    protocolVersion: PROTOCOL_VERSION,
    type: "heartbeat",
    sentAt: Date.now(),
    source: {
      ...source,
      processInstanceId: "empty-project-process",
      pluginInstanceId: "empty-project-plugin",
      projectId: "empty-project",
      projectName: "empty-project",
      directory: "/projects/empty-project",
    },
  })

  const state = getState()
  expect(state.ready).toBeFalse()
  expect(state.projects.some((project) => project.id === "empty-project")).toBeFalse()
})

test("projects historical sessions from other directories", () => {
  handleSnapshot({
    source,
    scope: "global",
    sessions: [
      {
        id: "historical-control-plane-session",
        projectId: "control-plane-project",
        projectName: "control-plane",
        directory: "/projects/control-plane",
        title: "Historical session",
        agent: "build",
        status: "idle",
        statusKnown: false,
        updatedAt: 1000,
      },
    ],
  })

  const state = getState()
  expect(state.ready).toBeTrue()
  expect(state.projects).toContainEqual(
    expect.objectContaining({ id: "control-plane-project", name: "control-plane" }),
  )
  expect(state.sessions).toContainEqual(
    expect.objectContaining({
      id: "historical-control-plane-session",
      projectId: "control-plane-project",
      status: "idle",
    }),
  )
})

test("historical metadata does not overwrite a known live status", () => {
  handleIngest([
    {
      protocolVersion: PROTOCOL_VERSION,
      type: "session.status.changed",
      sentAt: 2000,
      source,
      session: {
        id: "active-session",
        title: "Active session",
        agent: "general",
        status: "running",
        updatedAt: 2000,
      },
    },
  ])

  handleSnapshot({
    source: { ...source, processInstanceId: "historical-reader" },
    scope: "global",
    sessions: [
      {
        id: "active-session",
        projectId: source.projectId,
        title: "Active session",
        agent: "general",
        status: "idle",
        statusKnown: false,
        updatedAt: 3000,
      },
    ],
  })

  expect(getState().sessions).toContainEqual(
    expect.objectContaining({ id: "active-session", status: "running" }),
  )
})

test("routes session actions through an active OpenCode server", () => {
  const actionSource: SourceIdentity = {
    ...source,
    processInstanceId: "action-process",
    pluginInstanceId: "action-plugin",
    serverUrl: "http://127.0.0.1:9999",
    capabilities: ["session.write"],
  }
  handleSnapshot({
    source: actionSource,
    scope: "local",
    sessions: [
      {
        id: "action-parent",
        directory: "/projects/action-target",
        title: "Original title",
        status: "idle",
        updatedAt: 4000,
      },
      {
        id: "action-child",
        parentId: "action-parent",
        directory: "/projects/action-target",
        title: "Child session",
        status: "idle",
        updatedAt: 4000,
      },
    ],
  })

  expect(getSessionActionTarget("action-parent")).toEqual({
    directory: "/projects/action-target",
  })
  expect(applySessionRename("action-parent", "Renamed session")).toBeTrue()
  expect(
    getState().sessions.find((session) => session.id === "action-parent")?.title,
  ).toBe("Renamed session")
  expect(applySessionDelete("action-parent")).toBeTrue()
  expect(
    getState().sessions.some(
      (session) => session.id === "action-parent" || session.id === "action-child",
    ),
  ).toBeFalse()
})
