import { expect, test } from "bun:test"
import type { DashboardState } from "../src/shared/protocol"
import { mergeDashboardState } from "../src/web/api/dashboard-api"

const previous: DashboardState = {
  ready: true,
  processes: [],
  projects: [
    {
      id: "project-1",
      name: "Project",
      directories: ["/project"],
      sessionCount: 2,
      lastActivityAt: 100,
    },
  ],
  sessions: [
    {
      id: "active",
      projectId: "project-1",
      directory: "/project",
      title: "Old title",
      status: "running",
      updatedAt: 100,
    },
    {
      id: "inactive",
      projectId: "project-1",
      directory: "/project",
      title: "Inactive session",
      status: "idle",
      updatedAt: 50,
    },
  ],
}

test("merges partial live state without dropping inactive sessions", () => {
  const result = mergeDashboardState(previous, {
    ready: false,
    processes: [],
    projects: [{ ...previous.projects[0]!, sessionCount: 1 }],
    sessions: [{ ...previous.sessions[0]!, title: "Renamed session", updatedAt: 200 }],
  })

  expect(result.sessions).toHaveLength(2)
  expect(result.sessions.find((session) => session.id === "active")?.title).toBe(
    "Renamed session",
  )
  expect(result.sessions.some((session) => session.id === "inactive")).toBeTrue()
  expect(result.projects[0]?.sessionCount).toBe(2)
})

test("complete state replaces cached sessions", () => {
  const result = mergeDashboardState(previous, {
    ready: true,
    processes: [],
    projects: [{ ...previous.projects[0]!, sessionCount: 1 }],
    sessions: [{ ...previous.sessions[0]!, title: "Renamed session" }],
  })

  expect(result.sessions).toHaveLength(1)
  expect(result.sessions[0]?.title).toBe("Renamed session")
})
