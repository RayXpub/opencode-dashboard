import type { SessionCommand, SessionCommandResult } from "../shared/protocol";

type PendingCommand = {
  command: SessionCommand;
  resolve: (result: SessionCommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
  claimed: boolean;
};

const COMMAND_TIMEOUT_MS = 15_000;
const pending = new Map<string, PendingCommand>();

export function enqueueSessionCommand(
  command: Omit<SessionCommand, "id">,
): Promise<SessionCommandResult> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        commandId: id,
        ok: false,
        error: "OpenCode did not process the command in time",
      });
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, {
      command: { ...command, id },
      resolve,
      timer,
      claimed: false,
    });
  });
}

export function claimSessionCommands(): SessionCommand[] {
  const commands: SessionCommand[] = [];
  for (const item of pending.values()) {
    if (item.claimed) continue;
    item.claimed = true;
    commands.push(item.command);
  }
  return commands;
}

export function completeSessionCommand(result: SessionCommandResult): boolean {
  const item = pending.get(result.commandId);
  if (!item) return false;
  clearTimeout(item.timer);
  pending.delete(result.commandId);
  item.resolve(result);
  return true;
}
