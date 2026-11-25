<rules>
# Frontend Engineering Rules

## TypeScript & React

- **Arrow Functions**: Prefer arrow functions over `function` declarations.
- **Named Exports**: Prefer named exports/imports over default exports (except where an entry point requires a default export).
- **Import Alias**: Use `#src/...` for cross-directory imports instead of parent-relative `../` paths (same-directory `./` imports are fine).
- **Async/Await**: Prefer `async`/`await` with `try`/`catch` over `.then()`/`.catch()` chains.
- **Naming**: Use `camelCase` for variables, properties, and functions; `PascalCase` for components and types.
- **Biome Rules**: Follow `biome.json` (single quotes, semicolons as needed, 4-space indent, explicit `.ts`/`.tsx` import extensions, no `any`, no `==`, no `enum`, no unused variables or parameters).

## State & Structure

- **Component Directory Pattern**: Place each component in its own PascalCase directory (`src/components/<ComponentName>/`) containing:
    - `<ComponentName>.tsx` for the component implementation
    - `<ComponentName>.module.scss` alongside it for scoped styles (imported as `styles`)
    - `index.tsx` re-exporting the component's public members
- **Component Directory Pattern**: Place each component in its own PascalCase directory (`src/components/<ComponentName>/`) containing:
    - `<ComponentName>.tsx` for the component implementation
    - `<ComponentName>.module.scss` alongside it for scoped styles (imported as `styles`)
    - `index.tsx` re-exporting the component's public members
- Keep functions small (< ~50 lines) and state localized where possible.
- Maintain unidirectional, predictable data flow and avoid duplicating derived state.

## UI & Accessibility

- Design mobile-first and responsive by default.
- Use semantic HTML, proper ARIA labels, and keyboard-accessible controls.
  </rules>
