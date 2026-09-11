# OpenCode Dashboard

A local dashboard for monitoring OpenCode sessions and agent activity across projects.

## Installation

OpenCode loads server and TUI plugins separately. Add the package to both global configuration files.

`~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-dashboard"]
}
```

`~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-dashboard"]
}
```

Restart OpenCode after changing either configuration file. Run `/dashboard` in the TUI to start the local collector and open the dashboard in your default browser.

The dashboard binds to `127.0.0.1:4747` and remains available while the OpenCode TUI that launched it is running.

## Development

```bash
bun install --frozen-lockfile
bun run dev
```

Quality checks:

```bash
bun run lint
bun run typecheck
bun test
bun run build
```
