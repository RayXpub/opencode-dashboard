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

## Releases

Add a changeset to each pull request with a user-facing change:

```bash
bun run changeset
```

After changesets reach `main`, the release workflow creates or updates a version pull request. Merging the version pull request updates `package.json` and `CHANGELOG.md`, then creates and pushes a Git tag such as `v0.1.0`.

This package is private and the release workflow has no npm publish command or npm token. Releases exist only as versions, changelog entries, and Git tags.

GitHub repository settings must allow GitHub Actions to create pull requests under **Settings > Actions > General > Workflow permissions**.
