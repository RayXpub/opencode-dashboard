import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import {
  createOpencodeClient,
  type OpencodeClient,
  type OpencodeClientConfig,
} from "@opencode-ai/sdk/v2/client";
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

export function createGlobalSessionClient(client: TuiPluginApi["client"]) {
  const config = (
    client as unknown as {
      client: { getConfig(): OpencodeClientConfig };
    }
  ).client.getConfig();
  const headers = new Headers(config.headers as HeadersInit | undefined);
  headers.delete("x-opencode-directory");
  headers.delete("x-opencode-workspace");

  return createOpencodeClient({
    ...config,
    directory: undefined,
    experimental_workspaceID: undefined,
    headers,
  });
}

export async function listGlobalSessions(client: OpencodeClient) {
  const sessions: SnapshotSession[] = [];
  let cursor: number | undefined;

  do {
    const result = await client.experimental.session.list({
      archived: true,
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

  return sessions;
}

async function sendGlobalSnapshot(api: TuiPluginApi, source: SourceIdentity) {
  await sender.sendSnapshot({
    source,
    scope: "global",
    sessions: await listGlobalSessions(createGlobalSessionClient(api.client)),
  });
}

function openDashboard() {
  const url = `${dashboardUrl}/?v=${Date.now()}`;
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
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
