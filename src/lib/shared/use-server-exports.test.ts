import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const serverActionFiles = sourceFiles(SRC).filter((f) =>
  /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(readFileSync(f, "utf8")),
);

describe('"use server" modules', () => {
  // Next only allows async functions to be exported from a "use server" file.
  // Exporting a constant makes Turbopack treat the module as having NO exports,
  // so every importer fails the production build (8e7b35a, 2026-10-12).
  it("finds the server action files", () => {
    expect(serverActionFiles.length).toBeGreaterThan(10);
  });

  it.each(serverActionFiles.map((f) => relative(process.cwd(), f)))("%s exports only async functions and types", (file) => {
    const bad = readFileSync(join(process.cwd(), file), "utf8")
      .split("\n")
      .filter((line) => /^export\s+(const|let|var|class|enum|function\s)/.test(line));
    expect(bad, "move these out of the \"use server\" file (or make them non-exported)").toEqual([]);
  });
});
