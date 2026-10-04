import { describe, expect, test } from "bun:test"
import {
  listGlobalSessions,
  listGlobalSessionsWithClient,
} from "../src/plugin"
import { listGlobalSessions as listTuiGlobalSessions } from "../src/tui"

const pages = [
  [{ id: "active-session", title: "Active", time: { updated: 2 } }],
  [{ id: "archived-session", title: "Archived", time: { updated: 1 } }],
]

describe("global session discovery", () => {
  test("TUI requests every session page", async () => {
    const queries: Array<Record<string, unknown>> = []
    const client = {
      session: {
        list: async (query?: Record<string, unknown>) => {
          queries.push(query ?? {})
          const page = queries.length - 1
          return {
            data: pages[page],
            cursor: { next: page === 0 ? "cursor-2" : undefined },
          }
        },
      },
    }

    const sessions = await listTuiGlobalSessions(client.session as never)

    expect(queries).toEqual([
      { limit: 100, cursor: undefined },
      { limit: 100, cursor: "cursor-2" },
    ])
    expect(sessions.map((session) => session.id)).toEqual([
      "active-session",
      "archived-session",
    ])
  })

  test("direct server requests every session page", async () => {
    const queries: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        queries.push(url.search)
        const secondPage = url.searchParams.has("cursor")
        return Response.json({
          data: pages[secondPage ? 1 : 0],
          cursor: { next: secondPage ? undefined : "cursor-2" },
        })
      },
    })

    try {
      const sessions = await listGlobalSessions(new URL(server.url))
      expect(queries).toEqual([
        "?limit=100",
        "?limit=100&cursor=cursor-2",
      ])
      expect(sessions).toEqual(pages.flat())
    } finally {
      server.stop(true)
    }
  })

  test("client requests every session page", async () => {
    const queries: Array<Record<string, unknown>> = []
    const sessions = await listGlobalSessionsWithClient({
      async list(query?: { limit?: number; cursor?: string }) {
        queries.push(query ?? {})
        const secondPage = query?.cursor !== undefined
        return {
          data: pages[secondPage ? 1 : 0],
          cursor: { next: secondPage ? undefined : "cursor-2" },
        }
      },
    } as never)

    expect(queries).toEqual([
      { limit: 100, cursor: undefined },
      { limit: 100, cursor: "cursor-2" },
    ])
    expect(sessions).toEqual(pages.flat())
  })
})
