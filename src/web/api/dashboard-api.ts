import type { DashboardState } from "../../shared/protocol"

export function mergeDashboardState(
  previous: DashboardState | undefined,
  current: DashboardState,
): DashboardState {
  if (current.ready || !previous) return current

  const sessions = new Map(previous.sessions.map((session) => [session.id, session]))
  for (const session of current.sessions) sessions.set(session.id, session)

  const projects = new Map(previous.projects.map((project) => [project.id, project]))
  for (const project of current.projects) {
    const existing = projects.get(project.id)
    projects.set(project.id, {
      ...project,
      directories: [...new Set([...(existing?.directories ?? []), ...project.directories])],
    })
  }

  const mergedSessions = [...sessions.values()]
  const mergedProjects = [...projects.values()].map((project) => {
    const projectSessions = mergedSessions.filter(
      (session) => session.projectId === project.id,
    )
    return {
      ...project,
      sessionCount: projectSessions.length,
      lastActivityAt: Math.max(
        project.lastActivityAt,
        ...projectSessions.map((session) => session.updatedAt),
      ),
    }
  })

  return {
    ...current,
    projects: mergedProjects,
    sessions: mergedSessions,
  }
}

async function fetchDashboardState(): Promise<DashboardState> {
  const response = await fetch("/api/v1/state", { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard state: ${response.statusText}`)
  }
  return response.json()
}

export { fetchDashboardState }

async function sessionMutation(
  sessionId: string,
  init: RequestInit,
): Promise<void> {
  const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, init)
  if (response.ok) return

  const body = await response.json().catch(() => undefined)
  throw new Error(body?.error ?? `Session update failed: ${response.status}`)
}

export function renameSession(sessionId: string, title: string) {
  return sessionMutation(sessionId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
}

export function deleteSession(sessionId: string) {
  return sessionMutation(sessionId, { method: "DELETE" })
}
