import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

export function useDashboardEvents() {
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function connect() {
      const es = new EventSource("/api/v1/events")
      eventSourceRef.current = es

      es.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "connected") {
            return
          }
          if (data.type === "heartbeat" && !data.processInstanceId) return
          queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        } catch {
          // Ignore parse errors
        }
      })

      es.addEventListener("error", () => {
        es.close()
        eventSourceRef.current = null
        reconnectTimeoutRef.current = setTimeout(connect, 3_000)
      })
    }

    connect()

    return () => {
      eventSourceRef.current?.close()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [queryClient])
}
