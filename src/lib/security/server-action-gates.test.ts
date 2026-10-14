import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every exported Server Action is a public POST endpoint, so each one must start
// by calling a permission gate (AGENTS.md §5: RLS is a floor, actions re-check).
// The check is static: the first awaited call (or a `return helper(…)`
// delegation) in each exported function must reach one of the trusted gates
// below, following local and imported wrappers such as `approverGate()`.
// It proves the gate is called first, not that its result is honoured.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Trust roots — all in src/lib/auth/session.ts. */
const TRUSTED_GATES = new Set([
  "ensureCanEdit",
  "ensureCanEditSensitiveHr",
  "ensureEditor",
  "requireAdmin",
  "requireAdminView",
  "requireUser",
  "getCurrentUser",
]);

/** Unauthenticated forms (rate-limited). Only allowed outside the signed-in app. */
const PUBLIC_GATE = "allowPublicSubmission";
const isSignedInArea = (file: string) => /^src\/(app\/\(app\)|features)\//.test(file);

/** Gates that cannot use the session helpers, with the reason. Keep this short. */
const EXCEPTIONS: Record<string, string> = {
  // MFA runs before the session is fully verified, so getCurrentUser() would refuse it.
  "src/app/login/mfa/actions.ts#signedInGdoUser": "pre-MFA sign-in step",
};

const MAX_DEPTH = 5;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const sourceCache = new Map<string, string>();
function read(file: string): string {
  let src = sourceCache.get(file);
  if (src === undefined) {
    src = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : "";
    sourceCache.set(file, src);
  }
  return src;
}

/** Text of a top-level `async function name`, signature included (formatted code: it ends at the first bare `}` line). */
function functionBody(src: string, name: string, exportedOnly = false): string | null {
  const decl = new RegExp(`^${exportedOnly ? "export " : "(?:export )?"}async function ${name}\\b`, "m").exec(src);
  if (!decl) return null;
  const rest = src.slice(decl.index);
  const end = rest.search(/^\}\s*$/m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** First call that runs: `await x(` or a `return x(` delegation, whichever comes first. */
function firstCall(body: string): string | null {
  const m = /\b(?:await|return)\s+([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*)\s*\(/.exec(body);
  return m ? m[1] : null;
}

/** File that `name` is imported from, if it is a project-relative import. */
function importSource(file: string, name: string): string | null {
  const src = read(file);
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop());
    if (!names.includes(name)) continue;
    const spec = m[2];
    const base = spec.startsWith("@/")
      ? join("src", spec.slice(2))
      : spec.startsWith(".")
        ? join(dirname(file), spec)
        : null;
    if (!base) return null;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(join(ROOT, candidate))) return candidate;
    }
    return null;
  }
  return null;
}

/**
 * Follow `name` (called from `file`) down to a trusted gate; null when it gets
 * there. `actionFile` / `first` are the action's own file and first call, so
 * the message names what the action called, not where the trail ended.
 */
function gateProblem(
  file: string,
  name: string | null,
  depth: number,
  actionFile = file,
  first = name,
): string | null {
  if (!first) return "no awaited call — the action never checks permissions";
  const notAGate = `first call is ${first}(), which ${depth === 0 ? "is not" : "never reaches"} a permission gate`;
  if (!name) return notAGate;
  if (TRUSTED_GATES.has(name)) return null;
  if (name === PUBLIC_GATE) {
    return isSignedInArea(actionFile) ? `${PUBLIC_GATE}() is for public forms, not the signed-in app` : null;
  }
  if (EXCEPTIONS[`${file}#${name}`]) return null;
  if (name.includes(".")) return notAGate;
  if (depth >= MAX_DEPTH) return `gave up following wrappers at ${name}()`;

  const local = functionBody(read(file), name);
  if (local !== null) return gateProblem(file, firstCall(local), depth + 1, actionFile, first);

  const target = importSource(file, name);
  const imported = target ? functionBody(read(target), name, true) : null;
  if (target && imported !== null) return gateProblem(target, firstCall(imported), depth + 1, actionFile, first);

  return notAGate;
}

const serverActionFiles = sourceFiles(SRC)
  .filter((f) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f));

const actions = serverActionFiles.flatMap((file) =>
  [...read(file).matchAll(/^export async function (\w+)/gm)].map((m) => ({ file, name: m[1] })),
);

describe("Server Action permission gates", () => {
  it("finds the server actions", () => {
    expect(actions.length).toBeGreaterThan(100);
  });

  it.each(serverActionFiles)("every exported action in %s starts with a permission gate", (file) => {
    const problems = actions
      .filter((a) => a.file === file)
      .flatMap(({ name }) => {
        const problem = gateProblem(file, firstCall(functionBody(read(file), name, true) ?? ""), 0);
        return problem ? [`${name}: ${problem}`] : [];
      });
    expect(problems, "call ensureCanEdit(<module>) (or another gate in src/lib/auth/session.ts) first").toEqual([]);
  });

  it("is not fooled by an ungated action", () => {
    const dbFirst = 'export async function x(input: {\n  id: string;\n}): Promise<R> {\n  await supabase.from("x").delete();\n  const gate = await ensureCanEdit("hr");\n';
    expect(firstCall(dbFirst)).toBe("supabase.from");
    expect(gateProblem("src/app/(app)/x/actions.ts", firstCall(dbFirst), 0)).toMatch(/not a permission gate/);
    expect(gateProblem("src/app/(app)/x/actions.ts", "createClient", 0)).toMatch(/not a permission gate/);
    // Followed into src/lib/supabase/server.ts, but reported by the name the action used.
    expect(gateProblem("src/app/(app)/hr/actions.ts", "createClient", 0)).toBe(
      "first call is createClient(), which never reaches a permission gate",
    );
    expect(gateProblem("src/app/(app)/x/actions.ts", PUBLIC_GATE, 0)).toMatch(/public forms/);
    expect(gateProblem("src/app/(app)/x/actions.ts", null, 0)).toMatch(/never checks/);
  });
});
