import { execFile } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

/**
 * dsh-mnemosyne — DeepSeek Harness profile bundle for Mnemosyne.
 *
 * Registers five agent tools that proxy to the `mnemosyne` CLI
 * (pip install mnemosyne-memory), plus one embedded runtime skill:
 *   - mnemosyne_remember  → mnemosyne store <content> [source] [importance]
 *   - mnemosyne_recall    → mnemosyne recall <query> [top_k]
 *   - mnemosyne_forget    → mnemosyne delete <id>
 *   - mnemosyne_stats     → mnemosyne stats
 *   - mnemosyne_sleep     → mnemosyne sleep
 */

export const name = "mnemosyne";

export const inject = ["tools"];

export const Config = z.object({
  cli: z.string().default("mnemosyne").description("Mnemosyne CLI executable."),
  defaultTopK: z.number().default(5).description("Recall cap when the model omits top_k."),
  timeoutMs: z.number().default(20_000).description("Per-call CLI timeout in milliseconds."),
});

/** Run one `mnemosyne` subcommand and resolve with trimmed stdout. */
export function runMnemosyne(cli, command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      [command, ...args],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ENOENT") {
            reject(
              new Error(
                ` Mnemosyne CLI "${cli}" not found on PATH. Install it first: pip install mnemosyne-memory`
              )
            );
            return;
          }
          if (error.killed || error.signal === "SIGTERM") {
            reject(new Error(`mnemosyne ${command} timed out after ${timeoutMs}ms.`));
            return;
          }
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(String(stdout).trim());
      }
    );
  });
}

/** Positional-argument builders kept exported for tests. */
export function storeArgs({ content, source, importance }) {
  const args = [content];
  if (source !== undefined) args.push(source);
  if (importance !== undefined) args.push(String(importance));
  return args;
}

export function recallArgs({ query, topK }, defaultTopK) {
  return [query, String(topK ?? defaultTopK)];
}

const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

export function apply(ctx, config) {
  const cfg = () => config ?? {};
  const run = (command, args) =>
    runMnemosyne(cfg().cli ?? "mnemosyne", command, args, cfg().timeoutMs ?? 20_000);

  ctx.inject(["tools"], (sctx) => {
    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_remember",
            description:
              "Store a fact, preference, or observation in Mnemosyne memory. Use when the user reveals important context that should persist across sessions.",
            parameters: {
              content: { type: "string", required: true, description: "The memory content to store." },
              source: { type: "string", description: "Source tag for the memory (default: dsh)." },
              importance: {
                type: "number",
                description: "Importance score 0.0-1.0; higher ranks higher in recall.",
              },
            },
            output: TEXT_OUTPUT,
            async execute(args) {
              return run("store", storeArgs(args));
            },
          })
        ),
      "mnemosyne: remember tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_recall",
            description:
              "Search Mnemosyne memory by semantic similarity. Use before starting work on a task to retrieve relevant prior context.",
            parameters: {
              query: {
                type: "string",
                required: true,
                description: "Natural-language query describing what you need.",
              },
              top_k: {
                type: "number",
                description: `Maximum results to return (default: ${cfg().defaultTopK ?? 5}).`,
              },
            },
            output: TEXT_OUTPUT,
            async execute(args) {
              return run("recall", recallArgs({ query: args.query, topK: args.top_k }, cfg().defaultTopK ?? 5));
            },
          })
        ),
      "mnemosyne: recall tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_forget",
            description:
              "Delete a memory from Mnemosyne by its ID. Use when the user asks to remove outdated or incorrect information.",
            parameters: {
              id: {
                type: "string",
                required: true,
                description: "The memory ID returned by mnemosyne_remember.",
              },
            },
            output: TEXT_OUTPUT,
            async execute(args) {
              return run("delete", [args.id]);
            },
          })
        ),
      "mnemosyne: forget tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_stats",
            description:
              "Show Mnemosyne database statistics: memory counts, bank sizes, and model status.",
            parameters: {},
            output: TEXT_OUTPUT,
            async execute() {
              return run("stats", []);
            },
          })
        ),
      "mnemosyne: stats tool"
    );

    sctx.effect(
      () =>
        sctx.tools.register(
          defineTool({
            name: "mnemosyne_sleep",
            description:
              "Run Mnemosyne consolidation (sleep). Use at the end of a long session to compress working memories into long-term summaries.",
            parameters: {},
            output: TEXT_OUTPUT,
            async execute() {
              return run("sleep", []);
            },
          })
        ),
      "mnemosyne: sleep tool"
    );
  });

  // ponytail: skill 以 runtime 形式内嵌注册（rank 250，可被项目/用户级同名 skill 覆盖）；
  // 若日后需要随包分发更多资源文件，再改为文件系统 provider。
  const skills = ctx.get("skills");
  if (skills) {
    ctx.effect(() => skills.register(SKILL), "mnemosyne: skill");
  }
}

export const SKILL = {
  name: "mnemosyne",
  description:
    "Persist and recall memories across DSH sessions using Mnemosyne, a local-first SQLite-backed memory layer. Use when the user reveals preferences, constraints, or project facts that should survive sessions, or when starting work on a topic where prior context may help.",
  whenToUse:
    'The user states a preference ("remember that I use pnpm"), asks you to remember/forget something, or a new task likely has relevant prior context.',
  content: `# Mnemosyne

[Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) is a local-first AI memory layer. It stores facts, preferences, and observations in a SQLite database on your machine and surfaces them with semantic search. No cloud. No API keys.

This skill ships inside the \`dsh-mnemosyne\` plugin.

## When to use Mnemosyne

- The user states a preference ("I like my tests in \`tests/\`", "Use \`pnpm\` not \`npm\`").
- You learn something about the project that will matter in future sessions.
- You discover a bug, gotcha, or workaround worth remembering.
- You are starting a task and want to recall prior related context.
- The user asks you to remember or forget something.

## Available tools

- \`mnemosyne_remember\` — Store a memory.
- \`mnemosyne_recall\` — Search memories by semantic similarity.
- \`mnemosyne_forget\` — Delete a memory by ID.
- \`mnemosyne_stats\` — Show memory statistics.
- \`mnemosyne_sleep\` — Consolidate old memories into summaries.

## Usage examples

Remember a preference:

\`\`\`
Tool: mnemosyne_remember
content: "User prefers pytest with fixtures over unittest"
importance: 0.9
\`\`\`

Recall relevant context before a task:

\`\`\`
Tool: mnemosyne_recall
query: "testing preferences"
\`\`\`

Remove outdated info:

\`\`\`
Tool: mnemosyne_forget
id: "<memory-id-from-recall>"
\`\`\`

Consolidate at the end of a big session:

\`\`\`
Tool: mnemosyne_sleep
\`\`\`

## Best practices

- Store concise, factual memories. Avoid dumping entire conversations.
- Use \`importance\` between 0.7 and 0.95 for facts that should persist.
- Recall before starting work on a new but related task.
- Forget stale or incorrect memories when the user corrects you.
- Run \`mnemosyne_sleep\` occasionally to compress old working memories.

## Installation

\`\`\`bash
pip install mnemosyne-memory
dsh plugin --profile web add dsh-mnemosyne
\`\`\`
`,
};
