import type { PluginModule } from "@opencode-ai/plugin"
import server from "../plugin"

export default {
  id: "opencode-dashboard",
  server,
} satisfies PluginModule
