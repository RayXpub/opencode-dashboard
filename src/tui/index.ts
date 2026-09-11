import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import path from "node:path";
import { createServer } from "../collector/server";
import { sanitizeSession } from "../plugin/normalize";
import { TelemetrySender } from "../plugin/sender";
import {
  DEFAULT_COLLECTOR_PORT,
  type SnapshotSession,
  type SourceIdentity,
} from "../shared/protocol";

const hostname = "127.0.0.1";
const dashboardUrl = `http://${hostname}:${DEFAULT_COLLECTOR_PORT}`;
const dashboardRoot = import.meta.dir.includes(`${path.sep}src${path.sep}`)
  ? path.resolve(import.meta.dir, "../../dist")
  : path.resolve(import.meta.dir, "..");
let collector: ReturnType<typeof createServer> | undefined;
const sender = new TelemetrySender({ collectorUrl: dashboardUrl });

async function collectorIsAvailable() {
  try {
    const response = await fetch(`${dashboardUrl}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureCollector() {
  if (await collectorIsAvailable()) return;

  try {
    collector = createServer({
      hostname,
      port: DEFAULT_COLLECTOR_PORT,
      dashboardRoot,
    });
  } catch (error) {
    if (!(await collectorIsAvailable())) throw error;
  }
}

async function sendGlobalSnapshot(api: TuiPluginApi, source: SourceIdentity) {
  const sessions: SnapshotSession[] = [];
  let cursor: number | undefined;

  do {
    const result = await api.client.experimental.session.list({
      limit: 100,
      cursor,
    });
    if (result.error)
      throw new Error("Could not load persisted OpenCode sessions");
    for (const info of result.data ?? []) {
      const session = sanitizeSession(info);
      if (session) sessions.push({ ...session, statusKnown: false });
    }

    const nextCursor = result.response.headers.get("x-next-cursor");
    cursor = nextCursor ? Number(nextCursor) : undefined;
  } while (cursor !== undefined && Number.isFinite(cursor));

  await sender.sendSnapshot({ source, scope: "global", sessions });
}

function openDashboard() {
  const command =
    process.platform === "darwin"
      ? ["open", dashboardUrl]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", dashboardUrl]
        : ["xdg-open", dashboardUrl];
  const subprocess = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  subprocess.unref();
}

export default {
  id: "opencode-dashboard",
  tui: async (api) => {
    const directory = api.state.path.directory;
    const source: SourceIdentity = {
      kind: "tui",
      processInstanceId: crypto.randomUUID(),
      pluginInstanceId: crypto.randomUUID(),
      projectId: `tui:${directory}`,
      projectName: path.basename(directory) || "opencode",
      directory,
    };

    api.keymap.registerLayer({
      commands: [
        {
          name: "dashboard.open",
          namespace: "palette",
          slashName: "dashboard",
          title: "Open dashboard",
          category: "Dashboard",
          async run() {
            try {
              await ensureCollector();
              await sendGlobalSnapshot(api, source);
              openDashboard();
              api.ui.toast({
                variant: "success",
                title: "Dashboard",
                message: `Opened ${dashboardUrl}`,
              });
            } catch (error) {
              api.ui.toast({
                variant: "error",
                title: "Dashboard",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
      ],
    });

    api.lifecycle.onDispose(() => {
      collector?.stop();
      collector = undefined;
    });
  },
} satisfies TuiPluginModule;
