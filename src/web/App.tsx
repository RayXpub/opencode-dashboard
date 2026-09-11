import { useState, type FormEvent } from "react"
import type { DashboardSession, DashboardState } from "../shared/protocol"
import { useDashboard } from "./hooks/use-dashboard"
import { useSessionActions } from "./hooks/use-session-actions"
import {
  selectAgentSummaries,
  selectChildSessions,
  selectProjectTree,
  selectRunningSessions,
  type AgentSummary,
} from "./store/selectors"

function statusColor(status: string) {
  switch (status) {
    case "running":
      return "bg-[#198b43]"
    case "waiting":
      return "bg-[#ffb900]"
    case "retrying":
      return "bg-[#ff8904]"
    case "failed":
      return "bg-[#b82d35]"
    case "idle":
      return "bg-[var(--stats-dot)]"
    case "stale":
      return "bg-[var(--stats-faint)]"
    default:
      return "bg-[var(--stats-dot)]"
  }
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${statusColor(status)}`}
      title={status}
    />
  )
}

function formatUpdatedAt(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value)
}

function SessionRow({
  session,
  sessions,
  onEdit,
  depth = 0,
}: {
  session: DashboardSession
  sessions: DashboardSession[]
  onEdit: (session: DashboardSession) => void
  depth?: number
}) {
  const children = selectChildSessions(sessions, session.id)

  return (
    <>
      <tr className="group border-b border-[var(--stats-line)] bg-[var(--stats-layer)] transition-colors last:border-b-0 hover:bg-[var(--stats-layer-2)]">
        <td className="h-12 pr-5" style={{ paddingLeft: `${depth * 1.5 + 1}rem` }}>
          <div className="flex min-w-64 items-center gap-2.5">
            <span className="w-5 shrink-0 text-[10px] text-[var(--stats-faint)]">
              {depth > 0 ? "|_" : "[*]"}
            </span>
            <StatusDot status={session.status} />
            <span className="max-w-lg truncate text-[13px] font-medium text-[var(--stats-text)]">
              {session.title}
            </span>
            {session.parentId && (
              <span className="border border-[var(--stats-line-strong)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--stats-faint)]">
                subagent
              </span>
            )}
          </div>
        </td>
        <td className="h-12 px-4 text-[12px] font-medium text-[var(--stats-muted)]">
          {session.agent ?? "--"}
        </td>
        <td className="h-12 px-4 text-[12px] text-[var(--stats-muted)]">
          <span className="block max-w-56 truncate">{session.model ?? "--"}</span>
        </td>
        <td className="h-12 px-4">
          <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--stats-muted)]">
            <StatusDot status={session.status} />
            {session.status}
          </span>
        </td>
        <td className="h-12 pl-4 pr-4 text-right text-[11px] tabular-nums text-[var(--stats-faint)]">
          {formatUpdatedAt(session.updatedAt)}
        </td>
        <td className="h-12 px-4 text-right">
          <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onEdit(session)}
              className="h-7 border border-[var(--stats-line-strong)] px-2 text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--stats-muted)] hover:border-[var(--stats-accent-text)] hover:text-[var(--stats-accent-text)]"
            >
              Edit
            </button>
          </div>
        </td>
      </tr>
      {children.map((child) => (
        <SessionRow
          key={child.id}
          session={child}
          sessions={sessions}
          onEdit={onEdit}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

type SessionDialog = {
  session: DashboardSession
}

type OverviewMetric = "processes" | "sessions" | "agents" | "projects"

type DetailDialog =
  | { kind: "overview"; metric: OverviewMetric }
  | { kind: "agent"; agent: AgentSummary }

function DetailModal({
  eyebrow,
  title,
  children,
  onClose,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto border border-[var(--stats-line-strong)] bg-[var(--stats-bg)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-5 border-b border-[var(--stats-line)] p-5">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--stats-accent-text)]">
              {eyebrow}
            </p>
            <h2 id="detail-dialog-title" className="mt-2 text-lg font-medium tracking-[-0.03em]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 border border-[var(--stats-line-strong)] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-muted)] hover:border-[var(--stats-accent-text)] hover:text-[var(--stats-accent-text)]"
          >
            Close
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  )
}

function DetailRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[var(--stats-line)] border border-[var(--stats-line)]">{children}</div>
}

function OverviewDetails({
  metric,
  data,
  agents,
  running,
}: {
  metric: OverviewMetric
  data: DashboardState
  agents: AgentSummary[]
  running: DashboardSession[]
}) {
  if (metric === "processes") {
    return (
      <DetailRows>
        {data.processes.map((process) => (
          <div key={process.processInstanceId} className="grid gap-1 bg-[var(--stats-layer)] p-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="truncate text-xs font-medium">{process.processInstanceId}</p>
              <p className="mt-1 text-[10px] text-[var(--stats-faint)]">{process.projects.length} projects · OpenCode {process.openCodeVersion ?? "unknown"}</p>
            </div>
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--stats-muted)]">{process.stale ? "stale" : "connected"}</span>
          </div>
        ))}
      </DetailRows>
    )
  }

  if (metric === "sessions") {
    return (
      <DetailRows>
        {running.map((session) => (
          <div key={session.id} className="flex items-center justify-between gap-4 bg-[var(--stats-layer)] p-3">
            <span className="truncate text-xs font-medium">{session.title}</span>
            <span className="inline-flex items-center gap-2 text-[10px] uppercase text-[var(--stats-muted)]"><StatusDot status={session.status} />{session.status}</span>
          </div>
        ))}
        {running.length === 0 && <p className="p-5 text-xs text-[var(--stats-faint)]">No active sessions.</p>}
      </DetailRows>
    )
  }

  if (metric === "agents") {
    return (
      <DetailRows>
        {agents.map((agent) => (
          <div key={agent.name} className="grid grid-cols-[1fr_auto_auto] gap-5 bg-[var(--stats-layer)] p-3 text-xs">
            <span className="font-medium">{agent.name}</span>
            <span className="text-[var(--stats-muted)]">{agent.activeCount} active</span>
            <span className="text-[var(--stats-muted)]">{agent.sessionCount} sessions</span>
          </div>
        ))}
      </DetailRows>
    )
  }

  return (
    <DetailRows>
      {data.projects.map((project) => (
        <div key={project.id} className="grid gap-1 bg-[var(--stats-layer)] p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="text-xs font-medium">{project.name}</p>
            <p className="mt-1 truncate text-[10px] text-[var(--stats-faint)]">{project.directories.join(" · ")}</p>
          </div>
          <span className="text-[10px] uppercase text-[var(--stats-muted)]">{project.sessionCount} sessions</span>
        </div>
      ))}
    </DetailRows>
  )
}

function AgentDetails({ agent, sessions }: { agent: AgentSummary; sessions: DashboardSession[] }) {
  const matching = sessions.filter((session) => session.agent === agent.name)
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-px border border-[var(--stats-line)] bg-[var(--stats-line)]">
        {[["Active", agent.activeCount], ["Sessions", agent.sessionCount], ["Subagents", agent.subagentCount]].map(([label, value]) => (
          <div key={label} className="bg-[var(--stats-layer)] p-3">
            <p className="text-xl font-medium tabular-nums">{value}</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-[var(--stats-faint)]">{label}</p>
          </div>
        ))}
      </div>
      <DetailRows>
        {matching.map((session) => (
          <div key={session.id} className="grid grid-cols-[1fr_auto] gap-4 bg-[var(--stats-layer)] p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{session.title}</p>
              <p className="mt-1 truncate text-[10px] text-[var(--stats-faint)]">{session.model ?? "No model reported"}</p>
            </div>
            <span className="inline-flex items-center gap-2 text-[10px] uppercase text-[var(--stats-muted)]"><StatusDot status={session.status} />{session.status}</span>
          </div>
        ))}
      </DetailRows>
    </>
  )
}

function SessionActionDialog({
  dialog,
  title,
  error,
  pending,
  onTitleChange,
  onDelete,
  onClose,
  onSubmit,
}: {
  dialog: SessionDialog
  title: string
  error?: string
  pending: boolean
  onTitleChange: (title: string) => void
  onDelete: () => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" role="presentation" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-md border border-[var(--stats-line-strong)] bg-[var(--stats-bg)] shadow-2xl"
      >
        <div className="border-b border-[var(--stats-line)] p-5">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--stats-accent-text)]">
            Session action
          </p>
          <h2 id="session-dialog-title" className="mt-2 text-lg font-medium tracking-[-0.03em]">
            Edit session
          </h2>
          <p className="mt-2 truncate text-[11px] text-[var(--stats-faint)]">{dialog.session.title}</p>
        </div>

        <div className="p-5">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-faint)]">
              Session title
            </span>
            <input
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="mt-2 h-10 w-full border border-[var(--stats-line-strong)] bg-[var(--stats-layer)] px-3 text-[13px] text-[var(--stats-text)] outline-none focus:border-[var(--stats-accent-text)]"
            />
          </label>
          <div className="mt-6 border border-[#b82d35]/50 bg-[#b82d35]/5 p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#b82d35]">
              Danger zone
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--stats-muted)]">
              Permanently delete this session and its child sessions from OpenCode. This action cannot be undone.
            </p>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="mt-3 h-8 border border-[#b82d35] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[#b82d35] hover:bg-[#b82d35] hover:text-white disabled:opacity-50"
            >
              {pending ? "Working..." : "Delete session"}
            </button>
          </div>
          {error && <p className="mt-4 text-xs text-[#b82d35]">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--stats-line)] p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-8 border border-[var(--stats-line-strong)] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !title.trim()}
            className="h-8 bg-[#3b5cf6] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-white disabled:opacity-50"
          >
            {pending ? "Working..." : "Save title"}
          </button>
        </div>
      </form>
    </div>
  )
}

function PageMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-[var(--stats-bg)] text-[var(--stats-text)]">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center border-x border-[var(--stats-line)] px-6 md:px-10">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--stats-accent-text)]">
            OpenCode / Monitor
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{title}</h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[var(--stats-muted)]">{message}</p>
        </div>
      </div>
    </main>
  )
}

export function App() {
  const { data, isLoading, error } = useDashboard()
  const { rename, remove } = useSessionActions()
  const [dialog, setDialog] = useState<SessionDialog | null>(null)
  const [detailDialog, setDetailDialog] = useState<DetailDialog | null>(null)
  const [title, setTitle] = useState("")

  function openSessionDialog(session: DashboardSession) {
    rename.reset()
    remove.reset()
    setTitle(session.title)
    setDialog({ session })
  }

  async function submitSessionAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return

    try {
      await rename.mutateAsync({ sessionId: dialog.session.id, title: title.trim() })
      setDialog(null)
    } catch {
      // Mutation errors are rendered in the dialog.
    }
  }

  async function deleteSelectedSession() {
    if (!dialog) return

    try {
      await remove.mutateAsync(dialog.session.id)
      setDialog(null)
    } catch {
      // Mutation errors are rendered in the dialog.
    }
  }

  if (isLoading) {
    return <PageMessage title="Loading dashboard" message="Connecting to the local OpenCode collector." />
  }

  if (error && !data) {
    return <PageMessage title="Collector unavailable" message={error.message} />
  }

  if (!data) {
    return <PageMessage title="No data available" message="The collector returned an empty response." />
  }

  const running = selectRunningSessions(data.sessions)
  const projectTree = selectProjectTree(data.projects, data.sessions)
  const agents = selectAgentSummaries(data.sessions)
  const activeAgents = agents.reduce((count, agent) => count + agent.activeCount, 0)
  const connectedProcesses = data.processes.filter((process) => !process.stale)
  const staleProcesses = data.processes.length - connectedProcesses.length

  const metrics: Array<{ id: OverviewMetric; label: string; value: number; note: string }> = [
    { id: "processes", label: "Processes", value: connectedProcesses.length, note: staleProcesses ? `${staleProcesses} stale` : "Reporting now" },
    { id: "sessions", label: "Active sessions", value: running.length, note: `${data.sessions.length} total` },
    { id: "agents", label: "Active agents", value: activeAgents, note: `${agents.length} agent types` },
    { id: "projects", label: "Projects", value: data.projects.length, note: "With sessions" },
  ]

  return (
    <div className="min-h-screen bg-[var(--stats-bg)] text-[var(--stats-text)]">
      <header className="sticky top-0 z-50 border-b border-[var(--stats-line)] bg-[var(--stats-bg)]">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between border-x border-[var(--stats-line)] px-5 md:px-8 lg:px-10">
          <div className="flex items-center gap-4">
            <div className="flex h-8 items-center bg-[var(--stats-logo-bg)] px-2.5 text-[12px] font-semibold tracking-[-0.06em] text-[var(--stats-text-inverted)]">
              OPEN<span className="opacity-55">CODE</span>
            </div>
            <span className="hidden text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--stats-faint)] sm:inline">
              Session data
            </span>
          </div>
          <div className="flex h-8 items-center gap-2 border border-[var(--stats-line-strong)] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-muted)]">
            <span className={`size-1.5 rounded-full ${connectedProcesses.length ? "bg-[#198b43]" : "bg-[var(--stats-dot)]"}`} />
            {connectedProcesses.length ? "Collector live" : "No reporters"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl border-x border-[var(--stats-line)]">
        <section className="relative isolate flex min-h-52 flex-col justify-between overflow-hidden border-b border-[var(--stats-line)] px-6 pb-6 pt-12 md:min-h-60 md:px-10 md:pt-14">
          <div className="stats-pattern pointer-events-none absolute inset-0 -z-10" />
          <div className="w-fit bg-[var(--stats-bg)] pr-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--stats-accent-text)]">
              Local telemetry / Live
            </p>
            <h1 className="text-[clamp(2.5rem,7vw,4.5rem)] font-medium leading-none tracking-[-0.065em]">
              Dashboard
            </h1>
          </div>
          <p className="mt-6 max-w-xl self-end bg-[var(--stats-bg)] pl-0 text-sm leading-6 text-[var(--stats-hero-muted)] md:pl-6 md:text-right">
            Monitor OpenCode sessions and agent activity across every local project, without collecting prompts or model output.
          </p>
        </section>

        <section className="border-b border-[var(--stats-line)] px-6 py-8 md:px-10 md:py-10">
          <div className="mb-5 max-w-2xl">
            <h2 className="text-xl font-medium tracking-[-0.04em] md:text-2xl">
              <span className="text-[var(--stats-accent-text)]">Overview.</span>{" "}
              Current collector state.
            </h2>
          </div>
          <div className="grid gap-px border border-[var(--stats-line)] bg-[var(--stats-line)] sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <button type="button" key={metric.label} onClick={() => setDetailDialog({ kind: "overview", metric: metric.id })} className="flex min-h-28 flex-col justify-between bg-[var(--stats-layer)] p-4 text-left transition-colors hover:bg-[var(--stats-layer-2)] focus-visible:z-10">
                <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--stats-muted)]">
                  {metric.label}
                </p>
                <div>
                  <strong className="text-3xl font-medium leading-none tabular-nums tracking-[-0.05em]">
                    {metric.value}
                  </strong>
                  <p className="mt-2 text-[10px] text-[var(--stats-faint)]">{metric.note}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--stats-line)] px-6 py-8 md:px-10 md:py-10">
          <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="text-xl font-medium tracking-[-0.04em] md:text-2xl">
                <span className="text-[var(--stats-accent-text)]">Agents.</span>{" "}
                Activity by agent type.
              </h2>
              <p className="mt-2 text-xs text-[var(--stats-faint)]">Primary agents and nested subagents from all sessions.</p>
            </div>
            <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--stats-faint)]">
              {agents.length} types / {activeAgents} active
            </span>
          </div>

          {agents.length === 0 ? (
            <div className="border border-dashed border-[var(--stats-line-strong)] px-4 py-12 text-center text-xs text-[var(--stats-faint)]">
              No agent metadata reported yet
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-3">
              {agents.map((agent, index) => (
                <button type="button" key={agent.name} onClick={() => setDetailDialog({ kind: "agent", agent })} className="group min-h-32 border border-[var(--stats-line)] bg-[var(--stats-layer)] p-4 text-left transition hover:-translate-y-px hover:border-[var(--stats-line-strong)] hover:bg-[var(--stats-layer-2)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-[10px] tabular-nums text-[var(--stats-faint)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="truncate text-[13px] font-semibold text-[var(--stats-text)]">{agent.name}</h3>
                    </div>
                    <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-muted)]">
                      <StatusDot status={agent.status} />
                      {agent.status}
                    </span>
                  </div>
                  <div className="mt-6 grid grid-cols-3 border-t border-[var(--stats-line)] pt-3">
                    {[
                      ["Active", agent.activeCount],
                      ["Sessions", agent.sessionCount],
                      ["Subagents", agent.subagentCount],
                    ].map(([label, value]) => (
                      <div key={label} className="border-r border-[var(--stats-line)] px-3 first:pl-0 last:border-r-0 last:pr-0">
                        <p className="text-lg font-medium tabular-nums">{value}</p>
                        <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--stats-faint)]">{label}</p>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="px-6 py-8 md:px-10 md:py-10">
          <div className="mb-5">
            <h2 className="text-xl font-medium tracking-[-0.04em] md:text-2xl">
              <span className="text-[var(--stats-accent-text)]">Sessions.</span>{" "}
              Project activity.
            </h2>
            <p className="mt-2 text-xs text-[var(--stats-faint)]">Historical sessions remain visible; live states update from connected processes.</p>
          </div>

          <div className="space-y-8">
            {projectTree.map(({ project, sessions: projectSessions }, projectIndex) => (
              <article key={project.id}>
                <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-end">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[10px] tabular-nums text-[var(--stats-faint)]">
                      {String(projectIndex + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-base font-semibold tracking-[-0.03em]">{project.name}</h3>
                    <span className="text-[10px] text-[var(--stats-faint)]">{project.sessionCount} sessions</span>
                  </div>
                  <p className="max-w-md truncate text-[10px] text-[var(--stats-faint)]" title={project.directories[0]}>
                    {project.directories[0]}
                  </p>
                </div>

                <div className="overflow-x-auto border border-[var(--stats-line)]">
                  <table className="w-full min-w-[880px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[var(--stats-line)] bg-[var(--stats-bg)] text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--stats-faint)]">
                        <th className="h-10 px-4 font-medium">Session</th>
                        <th className="h-10 px-4 font-medium">Agent</th>
                        <th className="h-10 px-4 font-medium">Model</th>
                        <th className="h-10 px-4 font-medium">Status</th>
                        <th className="h-10 px-4 text-right font-medium">Updated</th>
                        <th className="h-10 px-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectSessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          sessions={data.sessions}
                          onEdit={openSessionDialog}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--stats-line)] bg-[var(--stats-bg)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 border-x border-[var(--stats-line)] px-6 py-5 text-[10px] uppercase tracking-[0.08em] text-[var(--stats-faint)] md:flex-row md:items-center md:justify-between md:px-10">
          <span>OpenCode Dashboard</span>
          <span>Local only / Metadata only</span>
        </div>
      </footer>
      {dialog && (
        <SessionActionDialog
          dialog={dialog}
          title={title}
          error={(rename.error ?? remove.error)?.message}
          pending={rename.isPending || remove.isPending}
          onTitleChange={setTitle}
          onDelete={deleteSelectedSession}
          onClose={() => setDialog(null)}
          onSubmit={submitSessionAction}
        />
      )}
      {detailDialog?.kind === "overview" && (
        <DetailModal
          eyebrow="Overview detail"
          title={metrics.find((metric) => metric.id === detailDialog.metric)?.label ?? "Overview"}
          onClose={() => setDetailDialog(null)}
        >
          <OverviewDetails metric={detailDialog.metric} data={data} agents={agents} running={running} />
        </DetailModal>
      )}
      {detailDialog?.kind === "agent" && (
        <DetailModal eyebrow="Agent detail" title={detailDialog.agent.name} onClose={() => setDetailDialog(null)}>
          <AgentDetails agent={detailDialog.agent} sessions={data.sessions} />
        </DetailModal>
      )}
    </div>
  )
}
