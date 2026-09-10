import type { DashboardSession, DashboardProject } from "../../shared/protocol"

export type AgentSummary = {
  name: string
  sessionCount: number
  activeCount: number
  subagentCount: number
  status: DashboardSession["status"]
  lastActivityAt: number
}

const statusPriority: Record<DashboardSession["status"], number> = {
  failed: 6,
  waiting: 5,
  retrying: 4,
  running: 3,
  idle: 2,
  stale: 1,
}

function selectRootSessions(
  sessions: DashboardSession[],
): DashboardSession[] {
  return sessions.filter((s) => !s.parentId)
}

export function selectChildSessions(
  sessions: DashboardSession[],
  parentId: string,
): DashboardSession[] {
  return sessions.filter((s) => s.parentId === parentId)
}

export function selectRunningSessions(
  sessions: DashboardSession[],
): DashboardSession[] {
  return sessions.filter(
    (s) => s.status === "running" || s.status === "waiting" || s.status === "retrying",
  )
}

export function selectProjectTree(
  projects: DashboardProject[],
  sessions: DashboardSession[],
) {
  const roots = selectRootSessions(sessions)
  return projects
    .map((project) => ({
      project,
      sessions: roots.filter((s) => s.projectId === project.id),
    }))
    .sort((a, b) => b.project.lastActivityAt - a.project.lastActivityAt)
}

export function selectAgentSummaries(
  sessions: DashboardSession[],
): AgentSummary[] {
  const summaries = new Map<string, AgentSummary>()

  for (const session of sessions) {
    if (!session.agent) continue

    const active = ["running", "waiting", "retrying"].includes(session.status)
    const existing = summaries.get(session.agent)
    if (!existing) {
      summaries.set(session.agent, {
        name: session.agent,
        sessionCount: 1,
        activeCount: active ? 1 : 0,
        subagentCount: session.parentId ? 1 : 0,
        status: session.status,
        lastActivityAt: session.updatedAt,
      })
      continue
    }

    existing.sessionCount += 1
    existing.activeCount += active ? 1 : 0
    existing.subagentCount += session.parentId ? 1 : 0
    existing.lastActivityAt = Math.max(existing.lastActivityAt, session.updatedAt)
    if (statusPriority[session.status] > statusPriority[existing.status]) {
      existing.status = session.status
    }
  }

  return [...summaries.values()].sort((a, b) => {
    if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount
    return b.lastActivityAt - a.lastActivityAt
  })
}
