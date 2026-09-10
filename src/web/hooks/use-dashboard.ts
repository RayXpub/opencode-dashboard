import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { DashboardState } from "../../shared/protocol"
import { fetchDashboardState, mergeDashboardState } from "../api/dashboard-api"
import { useDashboardEvents } from "../hooks/use-dashboard-events"

export function useDashboard() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () =>
      mergeDashboardState(
        queryClient.getQueryData<DashboardState>(["dashboard"]),
        await fetchDashboardState(),
      ),
    refetchInterval: 10_000,
  })

  useDashboardEvents()

  return query
}
