import { defineConfig } from "vitest/config";

// tsconfig's `@/* → ./src/*` alias, so pure modules under test can keep the same
// import paths as the app code (previously only `import type` from "@/…" worked
// in tests — see docs/agent/lessons.md).
export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
