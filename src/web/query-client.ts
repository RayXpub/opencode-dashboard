import { QueryClient } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
})

export const persistOptions = {
  persister: createSyncStoragePersister({
    storage: window.localStorage,
    key: "opencode-dashboard-query-cache",
  }),
  maxAge: Infinity,
  buster: "dashboard-protocol-v2",
}

export { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
