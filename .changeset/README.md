# Changesets

Add a changeset to every pull request that changes user-facing behavior:

```bash
bun run changeset
```

Choose `patch`, `minor`, or `major` and commit the generated Markdown file with the change. Documentation, test-only, and internal CI changes can use an empty changeset:

```bash
bun run changeset --empty
```

The release workflow creates a version pull request. Merging that pull request updates `package.json` and `CHANGELOG.md`, then creates a Git tag and GitHub release. This repository never publishes to npm.
