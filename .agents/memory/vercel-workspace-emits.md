---
name: Vercel workspace emits
description: Vercel Node builder behavior with TypeScript workspace imports.
---

When deploying a workspace package directly to Vercel, keep lightweight route entrypoints independent of runtime imports from sibling workspace packages when possible, and use explicit `.js` paths for local ESM imports.

**Why:** Vercel's per-file TypeScript emitter can report `Emit skipped` for a route when its module graph reaches source files outside the configured project root, even though the monorepo's local project-reference typecheck passes. Node's native ESM loader also rejects extensionless directory imports such as `./routes` after Vercel emits separate JavaScript files.

**How to apply:** For health checks and similarly static endpoints, return the small response directly and avoid importing generated validation packages unless the Vercel project root and build configuration explicitly compile the full workspace. Write local imports as `./routes/index.js`, with TypeScript resolving them back to the `.ts` source during development.