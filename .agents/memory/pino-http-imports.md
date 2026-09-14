---
name: Pino HTTP imports
description: Module import compatibility for pino-http in the API server.
---

Use the named `pinoHttp` export from `pino-http` rather than relying on the default import when the API server is typechecked in Vercel-like environments.

**Why:** Vercel's TypeScript resolution can treat the default import as the module namespace, producing a non-callable value and cascading implicit-any errors in serializer callbacks.

**How to apply:** When adding or updating pino HTTP middleware imports, prefer `import { pinoHttp } from "pino-http"` and verify the API package with its typecheck command.