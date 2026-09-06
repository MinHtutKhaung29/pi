# Skill Library plus Skill-Search Test Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove the tag index plus skill-search design works in pi with a small test slice: tags parsing, tag index in prompt, pure search, and a working `skill-search` core tool.

**Architecture:** Pure functions in `src/core/skills.ts` plus `src/core/tools/skill-search.ts`, registered through the existing `createAllToolDefinitions` path in `agent-session.ts:2779`. The tool reads skills through an injected provider wired to `this._resourceLoader.getSkills().skills`. Default active tools stay `["read", "bash", "edit", "write"]`.

**Tech Stack:** TypeScript, vitest, typebox schemas, existing `ToolDefinition` plus `wrapToolDefinition` pattern.

**Spec:** `tag-hints-vs-gate.md` O1 plus `harness-skills-research.md` R1. Out of scope: `packages/agent/src/harness` Skill type, `/skills` browser, hard gate, moving the catalog into the tool description.

## Global Constraints

- Tabs, strict TypeScript, no new runtime dependencies.
- `tags` is `string[]`, lowercase kebab-case, max 8 per skill.
- `Skill` gains a required `tags` field. Every literal `Skill` constructor must add `tags` (find via `grep -rn "disableModelInvocation" packages/coding-agent --include="*.ts"`).
- Tests run with `npx vitest --run` from `pi-fork/packages/coding-agent`. Typecheck with `npx tsc --noEmit`.
- Commit with `--no-verify` (pre-commit hook fails on pre-existing `interactive-mode.ts` lint).

---

## File Structure

- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts` — `Skill.tags`, `SkillFrontmatter.tags`, `normalizeSkillTags`, wire in `loadSkillFromFile`, add `formatSkillTagIndexForPrompt`, append index in `formatSkillsForPrompt`.
- Create: `pi-fork/packages/coding-agent/src/core/tools/skill-search.ts` — `searchSkills` pure plus `createSkillSearchToolDefinition` plus `createSkillSearchTool`.
- Modify: `pi-fork/packages/coding-agent/src/core/tools/index.ts` — exports, `ToolName`, `allToolNames`, `ToolsOptions`, all factory switches.
- Modify: `pi-fork/packages/coding-agent/src/core/agent-session.ts` — pass `skillSearch: { getSkills }` provider in `_buildRuntime`.
- Tests: extend `test/skills.test.ts`, create `test/skill-search.test.ts`, fix `Skill` literals in `test/resource-loader.test.ts`, `test/sdk-skills.test.ts`, `test/system-prompt.test.ts`, `test/suite/agent-session-prompt.test.ts`, `examples/sdk/04-skills.ts`.
- Fixtures: `test/fixtures/skills/tagged-skill/SKILL.md`, `test/fixtures/skills-lib/{ui-form,pdf-fill,git-review}/SKILL.md`.

---

### Task 1: Tags parsing

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts:75-92` (`SkillFrontmatter`, `Skill`), `loadSkillFromFile` return block.
- Test: `pi-fork/packages/coding-agent/test/skills.test.ts`.
- Fixture: `pi-fork/packages/coding-agent/test/fixtures/skills/tagged-skill/SKILL.md`.

**Interfaces:**
- Consumes: `frontmatter.tags: unknown`.
- Produces: `Skill.tags: string[]`, `normalizeSkillTags(input: unknown): string[]`.

- [ ] **Step 1: Add the fixture.**

```markdown
---
name: tagged-skill
description: A tagged skill for testing purposes. Use this when testing tag search.
tags: [pdf, forms]
---

# Tagged Skill
```

- [ ] **Step 2: Write the failing test.** Append to `test/skills.test.ts`:

```typescript
describe("skill tags", () => {
	it("parses tags array from frontmatter", () => {
		const { skills, diagnostics } = loadSkillsFromDir({
			dir: join(fixturesDir, "tagged-skill"),
			source: "test",
		});
		expect(skills).toHaveLength(1);
		expect(skills[0].tags).toEqual(["pdf", "forms"]);
		expect(diagnostics).toHaveLength(0);
	});

	it("defaults to empty tags when absent", () => {
		const { skills } = loadSkillsFromDir({
			dir: join(fixturesDir, "valid-skill"),
			source: "test",
		});
		expect(skills[0].tags).toEqual([]);
	});
});
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `npx vitest --run test/skills.test.ts -t "skill tags"`
Expected: FAIL with `skills[0].tags` undefined.

- [ ] **Step 4: Write minimal implementation.** In `src/core/skills.ts`:

```typescript
export interface SkillFrontmatter {
	name?: string;
	description?: string;
	tags?: unknown;
	"disable-model-invocation"?: boolean;
	[key: string]: unknown;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
	tags: string[];
}

export function normalizeSkillTags(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	for (const raw of input) {
		if (typeof raw !== "string") continue;
		const t = raw.trim().toLowerCase();
		if (!t || !/^[a-z0-9-]+$/.test(t) || out.includes(t)) continue;
		out.push(t);
	}
	return out.slice(0, 8);
}
```

In `loadSkillFromFile` return block add `tags: normalizeSkillTags(frontmatter.tags),`.

- [ ] **Step 5: Fix every `Skill` literal.** Run `grep -rn "disableModelInvocation" packages/coding-agent/src packages/coding-agent/test packages/coding-agent/examples --include="*.ts"` and add `tags: []` (or `tags` param in `createTestSkill`) to each. Then run `npx tsc --noEmit` from `pi-fork/packages/coding-agent` and fix stragglers.

- [ ] **Step 6: Run tests to verify they pass.**

Run: `npx vitest --run test/skills.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/coding-agent/src/core/skills.ts packages/coding-agent/test/skills.test.ts packages/coding-agent/test/fixtures/skills/tagged-skill/SKILL.md <fixed Skill literal files>
git commit --no-verify -m "feat: parse skill tags from frontmatter"
```

### Task 2: Tag index in prompt

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts` (`formatSkillsForPrompt`).
- Test: `pi-fork/packages/coding-agent/test/skills.test.ts`.

**Interfaces:**
- Consumes: `Skill[]`. Produces: `formatSkillTagIndexForPrompt(skills: Skill[]): string`.

- [ ] **Step 1: Write the failing test.**

```typescript
describe("tag index", () => {
	it("emits compact tag map for tagged skills only", () => {
		const skills: Skill[] = [
			createTestSkill({ name: "pdf-fill", description: "Fill PDFs.", filePath: "/s/pdf-fill/SKILL.md", baseDir: "/s/pdf-fill", tags: ["pdf", "forms"] }),
			createTestSkill({ name: "plain", description: "No tags.", filePath: "/s/plain/SKILL.md", baseDir: "/s/plain" }),
		];
		const out = formatSkillTagIndexForPrompt(skills);
		expect(out).toContain("pdf-fill: pdf, forms");
		expect(out).not.toContain("plain");
	});

	it("appends the index to formatSkillsForPrompt output", () => {
		const skills: Skill[] = [
			createTestSkill({ name: "pdf-fill", description: "Fill PDFs.", filePath: "/s/pdf-fill/SKILL.md", baseDir: "/s/pdf-fill", tags: ["pdf"] }),
		];
		expect(formatSkillsForPrompt(skills)).toContain("pdf-fill: pdf");
	});
});
```

`createTestSkill` gains an optional `tags?: string[]` defaulting to `[]`. Update its import of `formatSkillTagIndexForPrompt`.

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest --run test/skills.test.ts -t "tag index"`
Expected: FAIL with `formatSkillTagIndexForPrompt is not a function`.

- [ ] **Step 3: Write minimal implementation.** In `src/core/skills.ts`:

```typescript
export function formatSkillTagIndexForPrompt(skills: Skill[]): string {
	const visible = skills.filter((s) => !s.disableModelInvocation && s.tags.length > 0);
	if (visible.length === 0) return "";
	const lines = [
		"<skill_tag_index>",
		"If the task matches a tag, call skill-search with that tag before doing the work manually.",
		...visible.map((s) => `${s.name}: ${s.tags.join(", ")}`),
		"</skill_tag_index>",
	];
	return lines.join("\n");
}
```

At the end of `formatSkillsForPrompt`, before `return lines.join("\n")`, insert:

```typescript
	const tagIndex = formatSkillTagIndexForPrompt(skills);
	if (tagIndex) {
		lines.push("", tagIndex);
	}
```

This covers both `buildSystemPrompt` paths since both call `formatSkillsForPrompt`.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest --run test/skills.test.ts test/system-prompt.test.ts`
Expected: PASS. If prompt snapshot tests break, update snapshots only after confirming the diff is the added index block.

- [ ] **Step 5: Commit.**

```bash
git add packages/coding-agent/src/core/skills.ts packages/coding-agent/test/skills.test.ts
git commit --no-verify -m "feat: add skill tag index to prompt"
```

### Task 3: Pure search plus fixture library end to end

**Files:**
- Create: `pi-fork/packages/coding-agent/src/core/tools/skill-search.ts` (pure part only this task).
- Test: `pi-fork/packages/coding-agent/test/skill-search.test.ts`.
- Fixtures: `test/fixtures/skills-lib/{ui-form,pdf-fill,git-review}/SKILL.md` each with `tags` (`[ui]`, `[pdf, forms]`, `[git, review]`) and trigger rich descriptions.

**Interfaces:**
- Consumes: `Skill[]`, `{ query?: string; tag?: string; limit?: number }`.
- Produces: `searchSkills(skills, opts): Array<{ name: string; description: string; filePath: string; tags: string[] }>`.

- [ ] **Step 1: Write the failing tests.**

```typescript
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.ts";
import { searchSkills } from "../src/core/tools/skill-search.ts";

const libDir = resolve(__dirname, "fixtures/skills-lib");

describe("searchSkills", () => {
	it("filters by tag first", () => {
		const { skills } = loadSkillsFromDir({ dir: libDir, source: "test" });
		expect(skills).toHaveLength(3);
		expect(searchSkills(skills, { tag: "ui" }).map((h) => h.name)).toEqual(["ui-form"]);
	});

	it("matches query words against name plus description plus tags", () => {
		const { skills } = loadSkillsFromDir({ dir: libDir, source: "test" });
		expect(searchSkills(skills, { query: "review pull request" }).map((h) => h.name)).toEqual(["git-review"]);
	});

	it("combines tag plus query and caps limit", () => {
		const { skills } = loadSkillsFromDir({ dir: libDir, source: "test" });
		const hits = searchSkills(skills, { tag: "pdf", query: "fill", limit: 1 });
		expect(hits).toHaveLength(1);
		expect(hits[0].filePath).toContain("pdf-fill");
	});

	it("returns empty when nothing matches", () => {
		const { skills } = loadSkillsFromDir({ dir: libDir, source: "test" });
		expect(searchSkills(skills, { tag: "nope" })).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest --run test/skill-search.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation.** In `src/core/tools/skill-search.ts`:

```typescript
import type { Skill } from "../skills.ts";

export interface SkillSearchOptions {
	query?: string;
	tag?: string;
	limit?: number;
}

export interface SkillHit {
	name: string;
	description: string;
	filePath: string;
	tags: string[];
}

export function searchSkills(skills: Skill[], opts: SkillSearchOptions): SkillHit[] {
	const tag = (opts.tag ?? "").trim().toLowerCase();
	const query = (opts.query ?? "").trim().toLowerCase();
	const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
	let pool = skills.filter((s) => !s.disableModelInvocation);
	if (tag) pool = pool.filter((s) => s.tags.includes(tag));
	if (query) {
		const words = query.split(/\s+/);
		pool = pool.filter((s) => {
			const hay = `${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
			return words.every((w) => hay.includes(w));
		});
	}
	return pool
		.slice(0, limit)
		.map((s) => ({ name: s.name, description: s.description, filePath: s.filePath, tags: s.tags }));
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest --run test/skill-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/coding-agent/src/core/tools/skill-search.ts packages/coding-agent/test/skill-search.test.ts packages/coding-agent/test/fixtures/skills-lib
git commit --no-verify -m "feat: add pure skill search over fixture library"
```

### Task 4: skill-search core tool plus registration

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/tools/skill-search.ts` (append tool definition), `src/core/tools/index.ts`, `src/core/agent-session.ts` (`_buildRuntime`).
- Test: extend `test/skill-search.test.ts` with tool execute tests.

**Interfaces:**
- Consumes: `SkillSearchToolOptions { getSkills?: () => Skill[] }`.
- Produces: `createSkillSearchToolDefinition(cwd, options?)`, `createSkillSearchTool(cwd, options?)`.

- [ ] **Step 1: Write the failing tests.**

```typescript
import { createSkillSearchToolDefinition } from "../src/core/tools/skill-search.ts";

describe("skill-search tool", () => {
	it("returns hits from the provider", async () => {
		const { skills } = loadSkillsFromDir({ dir: libDir, source: "test" });
		const def = createSkillSearchToolDefinition("/tmp", { getSkills: () => skills });
		const result = await def.execute("t1", { tag: "pdf" }, undefined, undefined, undefined);
		const text = result.content.map((c: any) => c.text ?? "").join("\n");
		expect(text).toContain("pdf-fill");
	});

	it("reports no match without error", async () => {
		const def = createSkillSearchToolDefinition("/tmp", { getSkills: () => [] });
		const result = await def.execute("t2", { query: "zzz" }, undefined, undefined, undefined);
		const text = result.content.map((c: any) => c.text ?? "").join("\n");
		expect(text).toMatch(/no (matching )?skills/i);
	});
});
```

Adjust the `execute` call signature to match `ToolDefinition` in `src/core/extensions/types.ts`. Read that file first and correct the test before running.

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest --run test/skill-search.test.ts -t "skill-search tool"`
Expected: FAIL with `createSkillSearchToolDefinition is not a function`.

- [ ] **Step 3: Write minimal implementation.** Append to `src/core/tools/skill-search.ts`, following `grep.ts` shape (`Type.Object` schema, definition plus `wrapToolDefinition` wrapper):

```typescript
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const skillSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Keywords, e.g. 'fill pdf form'" })),
	tag: Type.Optional(Type.String({ description: "Tag filter, e.g. 'pdf'. See <skill_tag_index>." })),
	limit: Type.Optional(Type.Number({ description: "Max hits (default 5, max 10)" })),
});

export interface SkillSearchToolOptions {
	getSkills?: () => Skill[];
}

export function createSkillSearchToolDefinition(
	_cwd: string,
	options?: SkillSearchToolOptions,
): ToolDefinition<typeof skillSearchSchema, undefined> {
	const getSkills = options?.getSkills ?? (() => []);
	return {
		name: "skill-search",
		label: "skill-search",
		description:
			"Search installed skills by tag or keywords. Call this when the task matches a <skill_tag_index> tag instead of doing the work manually. Returns matching skill name, description, and file path, then read the file.",
		promptSnippet: "Search installed skills by tag or keywords",
		parameters: skillSearchSchema,
		async execute(_toolCallId, { query, tag, limit }: { query?: string; tag?: string; limit?: number }) {
			const hits = searchSkills(getSkills(), { query, tag, limit });
			if (hits.length === 0) {
				return { content: [{ type: "text", text: "No matching skills found" }], details: undefined };
			}
			const text = hits
				.map((h) => `- ${h.name}: ${h.description} (file: ${h.filePath}, tags: ${h.tags.join(", ") || "none"})`)
				.join("\n");
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}

export function createSkillSearchTool(cwd: string, options?: SkillSearchToolOptions): AgentTool<typeof skillSearchSchema> {
	return wrapToolDefinition(createSkillSearchToolDefinition(cwd, options));
}
```

Register in `src/core/tools/index.ts`: export, add `"skill-search"` to `ToolName` and `allToolNames`, add `skillSearch?: SkillSearchToolOptions` to `ToolsOptions`, add cases in `createToolDefinition`, `createTool`, `createAllToolDefinitions`, `createAllTools`. Do NOT add to `createCodingToolDefinitions` or default active names, tool stays dormant until enabled.

Wire the provider in `agent-session.ts` `_buildRuntime`:

```typescript
: createAllToolDefinitions(this._cwd, {
		read: { autoResizeImages },
		bash: { commandPrefix: shellCommandPrefix, shellPath },
		skillSearch: { getSkills: () => this._resourceLoader.getSkills().skills },
	});
```

- [ ] **Step 4: Run tests plus typecheck to verify they pass.**

Run: `npx vitest --run test/skill-search.test.ts test/skills.test.ts` then `npx tsc --noEmit`
Expected: PASS, no type errors. `sdk.ts`, `wrapper.ts`, `session-worker.ts` use `ToolName` as a type only, additive member is compatible, typecheck confirms.

- [ ] **Step 5: Manual session check.** Start pi with `--skill` pointing at `test/fixtures/skills-lib`, confirm `skill-search` is callable and returns `pdf-fill` for tag `pdf`, and the prompt contains `<skill_tag_index>`. Record result in the commit message body or PR.

- [ ] **Step 6: Commit.**

```bash
git add packages/coding-agent/src/core/tools/skill-search.ts packages/coding-agent/src/core/tools/index.ts packages/coding-agent/src/core/agent-session.ts packages/coding-agent/test/skill-search.test.ts
git commit --no-verify -m "feat: add skill-search core tool with resource loader provider"
```

## Self-Review

- Spec coverage: tags plus index plus search plus tool all land. Gate, browser, evals stay in their own plans.
- Placeholder scan: every step names exact files, commands, expected output. Task 4 Step 1 flags the one signature to confirm against `extensions/types.ts`.
- Type consistency: `Skill.tags`, `normalizeSkillTags`, `formatSkillTagIndexForPrompt`, `searchSkills`, `SkillSearchToolOptions`, `createSkillSearchToolDefinition` reused verbatim.
- Blast radius: default active tools unchanged, prompt gains the index block only when tagged skills exist.
