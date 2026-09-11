import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import {
  listGlobalSessions,
  listGlobalSessionsWithTransport,
} from "../src/plugin"
import {
  createGlobalSessionClient,
  listGlobalSessions as listTuiGlobalSessions,
} from "../src/tui"

const pages = [
  [{ id: "active-session", title: "Active", time: { updated: 2 } }],
  [{ id: "archived-session", title: "Archived", time: { updated: 1 } }],
]

describe("global session discovery", () => {
  test("TUI requests archived sessions on every page", async () => {
    const queries: Array<Record<string, unknown>> = []
    const client = {
      experimental: {
        session: {
          list: async (query: Record<string, unknown>) => {
            queries.push(query)
            const page = queries.length - 1
            return {
              data: pages[page],
              response: new Response(null, {
                headers: page === 0 ? { "x-next-cursor": "100" } : {},
              }),
            }
          },
        },
      },
    } as unknown as TuiPluginApi["client"]

    const sessions = await listTuiGlobalSessions(client)

    expect(queries).toEqual([
      { archived: true, limit: 100, cursor: undefined },
      { archived: true, limit: 100, cursor: 100 },
    ])
    expect(sessions.map((session) => session.id)).toEqual([
      "active-session",
      "archived-session",
    ])
  })

  test("TUI global client does not inherit the current directory", async () => {
    const requests: URL[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url))
        return Response.json(pages.flat())
      },
    })
    const scopedClient = {
      client: {
        getConfig: () => ({
          baseUrl: server.url.toString(),
          directory: "/projects/current",
          experimental_workspaceID: "current-workspace",
          headers: { "x-opencode-directory": "/projects/current" },
        }),
      },
    } as unknown as TuiPluginApi["client"]

    try {
      const sessions = await listTuiGlobalSessions(
        createGlobalSessionClient(scopedClient),
      )
      expect(requests).toHaveLength(1)
      expect(requests[0].searchParams.has("directory")).toBeFalse()
      expect(requests[0].searchParams.has("workspace")).toBeFalse()
      expect(requests[0].searchParams.get("archived")).toBe("true")
      expect(sessions.map((session) => session.id)).toEqual([
        "active-session",
        "archived-session",
      ])
    } finally {
      server.stop(true)
    }
  })

  test("direct server requests archived sessions on every page", async () => {
    const queries: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        queries.push(url.search)
        const secondPage = url.searchParams.has("cursor")
        return Response.json(pages[secondPage ? 1 : 0], {
          headers: secondPage ? {} : { "x-next-cursor": "100" },
        })
      },
    })

    try {
      const sessions = await listGlobalSessions(new URL(server.url))
      expect(queries).toEqual([
        "?archived=true&limit=100",
        "?archived=true&limit=100&cursor=100",
      ])
      expect(sessions).toEqual(pages.flat())
    } finally {
      server.stop(true)
    }
  })

  test("authenticated fallback requests archived sessions on every page", async () => {
    const queries: Array<Record<string, unknown>> = []
    const sessions = await listGlobalSessionsWithTransport({
      async get({ query }) {
        queries.push(query)
        const secondPage = query.cursor !== undefined
        return {
          data: pages[secondPage ? 1 : 0],
          response: new Response(null, {
            headers: secondPage ? {} : { "x-next-cursor": "100" },
          }),
        }
      },
    })

    expect(queries).toEqual([
      { archived: true, limit: 100, cursor: undefined },
      { archived: true, limit: 100, cursor: 100 },
    ])
    expect(sessions).toEqual(pages.flat())
  })
})
