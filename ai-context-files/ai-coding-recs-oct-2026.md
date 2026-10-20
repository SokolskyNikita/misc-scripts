# Coding agent tooling for large codebases (October 2026)

Recommendations for **Claude Code** and **OpenAI Codex** on large codebases and multi-repo work, ranked by impact.

> **Core idea:** grep + read + iterate already handles most code retrieval. What still improves results is context the code doesn't contain (instructions files, a repo catalog) and fast verification (typecheck and tests). Add tools only where they provide a capability grep doesn't.

Measure recommendations on real tasks (correctness, tokens, time) rather than assuming more tool calls are an improvement.

## 1. Claude Code

| # | Item | Why | When |
|---|---|---|---|
| 1 | `CLAUDE.md` + fast typecheck/test commands | Architecture, conventions, pitfalls, and a way for the agent to check its own work | Always |
| 2 | [Official LSP plugin](https://github.com/anthropics/claude-plugins-official) for your language(s) | Definitions, references, and **type errors reported automatically after each edit** | Always. Check that the server actually loads ([known issues](https://claudeissues.com/issue/15168-bug-lsp-plugin-system-not-connecting-to-language-servers-always-returns-no-lsp-s)) |
| 3 | [ast-grep](https://github.com/ast-grep/ast-grep) + [agent skill](https://github.com/ast-grep/agent-skill) | Structural search and reliable codemods | Always |
| 4 | Local repo mirror + `REPOS.md` catalog | Tells the agent *which* repo to look in | Multi-repo work |
| 5 | [tgrep](https://github.com/microsoft/tgrep) | Indexed regex search, much faster than ripgrep on huge trees | 100K+ files |
| 6 | [Sourcebot](https://docs.sourcebot.dev/docs/more/mcp-server) + MCP | Self-hosted, Zoekt-based search across all repos and branches | The mirror gets painful, or a team needs a shared index |

## 2. OpenAI Codex

| # | Item | Why | When |
|---|---|---|---|
| 1 | `AGENTS.md` + fast typecheck/test commands | Same as above | Always |
| 2 | [ast-grep](https://github.com/ast-grep/ast-grep) + [agent skill](https://github.com/ast-grep/agent-skill) | Same as above | Always |
| 3 | [Serena](https://github.com/oraios/serena) (`--context codex`) | Codex has no native LSP; Serena is the most established LSP-over-MCP option. The agent must choose to call it (no automatic diagnostics), so it's worth less than Claude's native LSP | Large typed codebases |
| 4 | Local repo mirror + `REPOS.md` catalog | Same as above | Multi-repo work |
| 5 | [tgrep](https://github.com/microsoft/tgrep) | Same as above | 100K+ files |
| 6 | [Sourcebot](https://docs.sourcebot.dev/docs/more/mcp-server) + MCP | Same as above | Same as above |

## Setup notes

```bash
brew install ripgrep fd ast-grep jq gh
```

- **Claude LSP:** in an interactive `claude` session run `/plugin`, install the plugin for your language, and install the language server binary itself (e.g. `npm i -g pyright`, `brew install gopls`).
- **Serena (Codex):** `uv tool install -p 3.13 serena-agent`, then register it as an MCP server with `--context codex`. Check the [README](https://github.com/oraios/serena) for the current command. Codex may need `activate_project` called at the start of each session.
- **Sourcebot:** its MCP server only works with authentication disabled, so keep it on localhost or a private network. Check the license before using it on company code.
- **Both agents:** keep one source of truth. Write `AGENTS.md` and put `@AGENTS.md` in `CLAUDE.md`, or symlink one to the other.
- **Tool instructions:** list the tools in the instructions file *with when they help*, but don't make them mandatory. Otherwise agents either ignore them or overuse them.

## Deliberately excluded

| Tool | Reason |
|---|---|
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | PolyForm **Noncommercial** license; benefit claims are vendor-only; overlaps with LSP + grep; its hooks inject context into every search |
| Serena on Claude Code | Duplicates the native LSP plugin. Fix the plugin instead |
| [agent-lsp](https://github.com/blackwell-systems/agent-lsp), [codex-lsp](https://github.com/code-yeongyu/codex-lsp) | Redundant with Serena / experimental; codex-lsp runs as hooks in every session |
| Embedding / vector code search | Semantic similarity is often not relevance in code; indexes go stale; trigram search wins on "where is X used" |
| Sourcegraph, [Glean](https://glean.software/), [Kythe](https://kythe.io/), [SCIP](https://github.com/sourcegraph/scip) | Precise cross-repo references, but a platform-team project (build integration plus infrastructure), not an install |