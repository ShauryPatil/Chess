---
name: Node input-type and bundled workers
description: Avoiding Node runner flags that leak into worker threads during bundled server checks.
---

When checking an ESM bundle that starts worker threads, avoid launching it with `node --input-type=module`; Node can propagate that flag into workers and make them fail with `ERR_INPUT_TYPE_NOT_ALLOWED`. Use a normal package-mode `node -e` dynamic import instead.

**Why:** The bundled API server's logger dependencies include worker entrypoints, and the runner-only flag is invalid when those workers start from files.

**How to apply:** For built server smoke checks, set the needed environment variables and use `node -e 'import("...")...'` rather than `--input-type=module`.