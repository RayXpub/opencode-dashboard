import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import {
  persistOptions,
  PersistQueryClientProvider,
  queryClient,
} from "./query-client"

const container = document.getElementById("root")

if (!container) {
  throw new Error("Missing root element")
}

createRoot(container).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
