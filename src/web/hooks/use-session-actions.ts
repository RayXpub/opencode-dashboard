import { useMutation, useQueryClient } from "@tanstack/react-query"
import { deleteSession, renameSession } from "../api/dashboard-api"

export function useSessionActions() {
  const queryClient = useQueryClient()
  const rename = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      renameSession(sessionId, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  })
  const remove = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  })

  return { rename, remove }
}
