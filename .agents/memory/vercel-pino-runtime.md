---
name: Vercel Pino runtime
description: Serverless logging constraint for the API bundle.
---

Do not enable Pino transports such as `pino-pretty` when the API runs on Vercel; use Pino's direct stdout logger in that environment.

**Why:** The bundled transport depends on worker entrypoints and filesystem paths produced in the workspace build environment, which can fail inside Vercel's serverless runtime.

**How to apply:** Detect Vercel explicitly and also treat a missing `PORT` as serverless mode instead of relying only on `NODE_ENV`, because a function invocation may not expose the expected deployment values.