import { useState, type FormEvent } from "react"
import type { DashboardSession } from "../shared/protocol"
import { useDashboard } from "./hooks/use-dashboard"
import { useSessionActions } from "./hooks/use-session-actions"
import {
  selectAgentSummaries,
  selectChildSessions,
  selectProjectTree,
  selectRunningSessions,
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
  onRename,
  onDelete,
  depth = 0,
}: {
  session: DashboardSession
  sessions: DashboardSession[]
  onRename: (session: DashboardSession) => void
  onDelete: (session: DashboardSession) => void
  depth?: number
}) {
  const children = selectChildSessions(sessions, session.id)

  return (
    <>
      <tr className="group border-b border-[var(--stats-line)] bg-[var(--stats-layer)] transition-colors last:border-b-0 hover:bg-[var(--stats-layer-2)]">
        <td className="h-14 pr-5" style={{ paddingLeft: `${depth * 1.5 + 1}rem` }}>
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
        <td className="h-14 px-4 text-[12px] font-medium text-[var(--stats-muted)]">
          {session.agent ?? "--"}
        </td>
        <td className="h-14 px-4 text-[12px] text-[var(--stats-muted)]">
          <span className="block max-w-56 truncate">{session.model ?? "--"}</span>
        </td>
        <td className="h-14 px-4">
          <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--stats-muted)]">
            <StatusDot status={session.status} />
            {session.status}
          </span>
        </td>
        <td className="h-14 pl-4 pr-4 text-right text-[11px] tabular-nums text-[var(--stats-faint)]">
          {formatUpdatedAt(session.updatedAt)}
        </td>
        <td className="h-14 px-4 text-right">
          <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onRename(session)}
              className="h-7 border border-[var(--stats-line-strong)] px-2 text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--stats-muted)] hover:border-[var(--stats-accent-text)] hover:text-[var(--stats-accent-text)]"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(session)}
              className="h-7 border border-[var(--stats-line-strong)] px-2 text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--stats-muted)] hover:border-[#b82d35] hover:text-[#b82d35]"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {children.map((child) => (
        <SessionRow
          key={child.id}
          session={child}
          sessions={sessions}
          onRename={onRename}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

type SessionDialog = {
  mode: "rename" | "delete"
  session: DashboardSession
}

function SessionActionDialog({
  dialog,
  title,
  error,
  pending,
  onTitleChange,
  onClose,
  onSubmit,
}: {
  dialog: SessionDialog
  title: string
  error?: string
  pending: boolean
  onTitleChange: (title: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const deleting = dialog.mode === "delete"

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
            {deleting ? "Delete session?" : "Rename session"}
          </h2>
          <p className="mt-2 truncate text-[11px] text-[var(--stats-faint)]">{dialog.session.title}</p>
        </div>

        <div className="p-5">
          {deleting ? (
            <p className="text-sm leading-6 text-[var(--stats-muted)]">
              This permanently deletes the session and its child sessions from OpenCode. This action cannot be undone.
            </p>
          ) : (
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
          )}
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
            disabled={pending || (!deleting && !title.trim())}
            className={`h-8 px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-white disabled:opacity-50 ${deleting ? "bg-[#b82d35]" : "bg-[#3b5cf6]"}`}
          >
            {pending ? "Working..." : deleting ? "Delete" : "Save title"}
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
  const [title, setTitle] = useState("")

  function openSessionDialog(mode: SessionDialog["mode"], session: DashboardSession) {
    rename.reset()
    remove.reset()
    setTitle(session.title)
    setDialog({ mode, session })
  }

  async function submitSessionAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return

    try {
      if (dialog.mode === "rename") {
        await rename.mutateAsync({ sessionId: dialog.session.id, title: title.trim() })
      } else {
        await remove.mutateAsync(dialog.session.id)
      }
      setDialog(null)
    } catch {
      // Mutation errors are rendered in the dialog.
    }
  }

  if (isLoading) {
    return <PageMessage title="Loading session data" message="Connecting to the local OpenCode collector." />
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

  const metrics = [
    { label: "Processes", value: connectedProcesses.length, note: staleProcesses ? `${staleProcesses} stale` : "Reporting now" },
    { label: "Active sessions", value: running.length, note: `${data.sessions.length} total` },
    { label: "Active agents", value: activeAgents, note: `${agents.length} agent types` },
    { label: "Projects", value: data.projects.length, note: "With sessions" },
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
        <section className="relative isolate flex min-h-72 flex-col justify-between overflow-hidden border-b border-[var(--stats-line)] px-6 pb-8 pt-24 md:min-h-80 md:px-10 md:pt-28">
          <div className="stats-pattern pointer-events-none absolute inset-0 -z-10" />
          <div className="w-fit bg-[var(--stats-bg)] pr-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--stats-accent-text)]">
              Local telemetry / Live
            </p>
            <h1 className="text-[clamp(2.5rem,7vw,4.5rem)] font-medium leading-none tracking-[-0.065em]">
              Session Data
            </h1>
          </div>
          <p className="mt-12 max-w-xl self-end bg-[var(--stats-bg)] pl-0 text-sm leading-6 text-[var(--stats-hero-muted)] md:pl-6 md:text-right md:text-base">
            Monitor OpenCode sessions and agent activity across every local project, without collecting prompts or model output.
          </p>
        </section>

        <section className="border-b border-[var(--stats-line)] px-6 py-16 md:px-10 md:py-20">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-xl font-medium tracking-[-0.04em] md:text-2xl">
              <span className="text-[var(--stats-accent-text)]">Overview.</span>{" "}
              Current collector state.
            </h2>
          </div>
          <div className="grid gap-px border border-[var(--stats-line)] bg-[var(--stats-line)] sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <article key={metric.label} className="flex min-h-36 flex-col justify-between bg-[var(--stats-layer)] p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--stats-muted)]">
                  {metric.label}
                </p>
                <div>
                  <strong className="text-3xl font-medium leading-none tabular-nums tracking-[-0.05em]">
                    {metric.value}
                  </strong>
                  <p className="mt-2 text-[10px] text-[var(--stats-faint)]">{metric.note}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-b border-[var(--stats-line)] px-6 py-16 md:px-10 md:py-20">
          <div className="mb-8 flex flex-col justify-between gap-3 md:flex-row md:items-end">
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
                <article key={agent.name} className="group min-h-40 border border-[var(--stats-line)] bg-[var(--stats-layer)] p-4 transition hover:-translate-y-px hover:border-[var(--stats-line-strong)] hover:bg-[var(--stats-layer-2)]">
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
                  <div className="mt-10 grid grid-cols-3 border-t border-[var(--stats-line)] pt-3">
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
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="px-6 py-16 md:px-10 md:py-20">
          <div className="mb-8">
            <h2 className="text-xl font-medium tracking-[-0.04em] md:text-2xl">
              <span className="text-[var(--stats-accent-text)]">Sessions.</span>{" "}
              Project activity.
            </h2>
            <p className="mt-2 text-xs text-[var(--stats-faint)]">Historical sessions remain visible; live states update from connected processes.</p>
          </div>

          <div className="space-y-14">
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
                          onRename={(selected) => openSessionDialog("rename", selected)}
                          onDelete={(selected) => openSessionDialog("delete", selected)}
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
        <div className="mx-auto flex max-w-7xl flex-col gap-2 border-x border-[var(--stats-line)] px-6 py-8 text-[10px] uppercase tracking-[0.08em] text-[var(--stats-faint)] md:flex-row md:items-center md:justify-between md:px-10">
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
          onClose={() => setDialog(null)}
          onSubmit={submitSessionAction}
        />
      )}
    </div>
  )
}
