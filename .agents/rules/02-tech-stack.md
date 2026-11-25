<stack>
- Language: TypeScript
- UI: React 19 + Vite
- Runtime & Package Manager: Bun (managed by mise)
- Linter & Formatter: Biome
- Backend / Hosting: Firebase (Firestore + Hosting)
</stack>

<rules>
# Tech Stack & Tooling

## Environment & Commands

- **Use `mise` and `bun`**: Run project tasks via `mise run <task>` (`dev`, `build`, `start`, `test`, `check`, `format`, `lint`, `validate`, `deploy`, `deploy:hosting`, `deploy:rules`) from the repository root.
- **No bare Node/npm/npx**: Use `bun` / `bun --bun` / `bunx --bun` for any one-off JS/TS commands.
- **Cross-Platform**: Keep `mise.toml` tasks, scripts, and paths compatible with both macOS and Windows.

## Dependencies & Tool Versions

- Pin all `package.json` `"dependencies"` to exact versions and keep them alphabetized.
- Manage CLI tool versions (`biome`, `bun`, `firebase`, `gh`, `git-lfs`) in `mise.toml`.

## Validation

- At stopping points or after finishing a feature, verify with `mise run validate`.
  </rules>
