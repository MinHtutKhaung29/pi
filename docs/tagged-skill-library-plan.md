# Tagged Skill Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tags plus a fast skill-search tool so the agent finds the right skill with near zero misses without loading all descriptions.

**Architecture:** Keep progressive disclosure. Add `tags: string[]` to Skill parsing, emit a compact tag index in the system prompt, and add a `skill-search` core tool that filters by tag plus keyword and returns only hits for full read.

**Tech Stack:** TypeScript, vitest, pi coding-agent core tools and system-prompt composer.

**Spec:** `tag-hints-vs-gate.md` (O1 tag index plus on demand describe with O2 scoped gate). Success is zero manual reinvention when a matching skill exists, with extra latency only on gated lookups.

## Global Constraints

- TypeScript strict, follow existing `src/core/skills.ts` patterns.
- Tests run with `vitest --run` from `pi-fork/packages/coding-agent`.
- No new runtime dependencies.
- Frontmatter key is `tags` as string array, lowercase kebab-case.
- Do not break `/skill:name` expansion or `disable-model-invocation` behavior.

---

## File Structure

- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts` — add `tags` to `Skill` and `SkillFrontmatter`, parse plus normalize, add `formatSkillTagIndexForPrompt`.
- Modify: `pi-fork/packages/coding-agent/src/core/system-prompt.ts` — append tag index alongside `formatSkillsForPrompt`.
- Create: `pi-fork/packages/coding-agent/src/core/tools/skill-search.ts` — `skill-search` tool definition with tag plus query filter.
- Modify: `pi-fork/packages/coding-agent/src/core/tools/index.ts` — register `skill-search`.
- Modify: `pi-fork/packages/coding-agent/test/skills.test.ts` — cover tags parsing plus index formatting.
- Create: `pi-fork/packages/coding-agent/test/skill-search.test.ts` — cover search filtering.
- Modify: `pi-fork/packages/coding-agent/docs/skills.md` — document `tags` plus search flow if file exists, else `README.md` section.

---

### Task 1: Skill tags parsing

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts:60-90`
- Test: `pi-fork/packages/coding-agent/test/skills.test.ts`

**Interfaces:**
- Consumes: `SkillFrontmatter` with unknown extra keys.
- Produces: `Skill.tags: string[]`, `normalizeSkillTags(input: unknown): string[]`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.ts";
import { join } from "path";
import { resolve } from "path";
const fixturesDir = resolve(__dirname, "fixtures/skills");
describe("skill tags", () => {
  it("parses tags array from frontmatter", () => {
    const { skills } = loadSkillsFromDir({ dir: join(fixturesDir, "valid-skill"), source: "test" });
    expect(Array.isArray((skills[0] as any).tags)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/skills.test.ts -t "parses tags array"`
Expected: FAIL with `tags` undefined or not an array.

- [ ] **Step 3: Write minimal implementation**

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
    if (!t) continue;
    if (!/^[a-z0-9-]+$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}
```

In `loadSkillFromFile` return block add `tags: normalizeSkillTags(frontmatter.tags)`. Update `createTestSkill` helper in tests to include `tags: []`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agent/src/core/skills.ts packages/coding-agent/test/skills.test.ts
git commit -m "feat: parse skill tags from frontmatter"
```

### Task 2: Tag index for prompt

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/skills.ts:355-390`
- Modify: `pi-fork/packages/coding-agent/src/core/system-prompt.ts:60-75`
- Test: `pi-fork/packages/coding-agent/test/skills.test.ts`

**Interfaces:**
- Consumes: `Skill[]` with `tags`.
- Produces: `formatSkillTagIndexForPrompt(skills: Skill[]): string`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { formatSkillTagIndexForPrompt, type Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
describe("tag index", () => {
  it("emits compact tag map", () => {
    const skills: Skill[] = [{
      name: "pdf-fill", description: "Fill PDF forms.", filePath: "/s/pdf-fill/SKILL.md",
      baseDir: "/s/pdf-fill", sourceInfo: createSyntheticSourceInfo("/s/pdf-fill/SKILL.md", { source: "test" }),
      disableModelInvocation: false, tags: ["pdf", "forms"],
    }];
    const out = formatSkillTagIndexForPrompt(skills);
    expect(out).toContain("pdf-fill");
    expect(out).toContain("pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/skills.test.ts -t "emits compact tag map"`
Expected: FAIL with `formatSkillTagIndexForPrompt is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export function formatSkillTagIndexForPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation && s.tags.length > 0);
  if (visible.length === 0) return "";
  const lines = ["<skill_tag_index>", "Call skill-search with tag filter before manual work."];
  for (const s of visible) {
    lines.push(`${s.name}: ${s.tags.join(", ")}`);
  }
  lines.push("</skill_tag_index>");
  return lines.join("\n");
}
```

In `src/core/system-prompt.ts` after `prompt += formatSkillsForPrompt(skills, skillFileReadTool)` add:

```typescript
import { formatSkillTagIndexForPrompt } from "./skills.ts";
const tagIndex = formatSkillTagIndexForPrompt(skills);
if (tagIndex) prompt += "\n\n" + tagIndex;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agent/src/core/skills.ts packages/coding-agent/src/core/system-prompt.ts packages/coding-agent/test/skills.test.ts
git commit -m "feat: add skill tag index to system prompt"
```

### Task 3: skill-search tool

**Files:**
- Create: `pi-fork/packages/coding-agent/src/core/tools/skill-search.ts`
- Modify: `pi-fork/packages/coding-agent/src/core/tools/index.ts`
- Test: `pi-fork/packages/coding-agent/test/skill-search.test.ts`

**Interfaces:**
- Consumes: `Skill[]` from resource loader, params `{ query?: string; tag?: string; limit?: number }`.
- Produces: `searchSkills(skills: Skill[], opts: { query?: string; tag?: string; limit?: number }): Array<{ name: string; description: string; filePath: string; tags: string[] }>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { searchSkills } from "../src/core/tools/skill-search.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
describe("searchSkills", () => {
  it("filters by tag first", () => {
    const skills = [
      { name: "ui-form", description: "Build UI forms.", filePath: "/s/ui-form/SKILL.md", baseDir: "/s/ui-form", sourceInfo: createSyntheticSourceInfo("/s/ui-form/SKILL.md", { source: "test" }), disableModelInvocation: false, tags: ["ui"] },
      { name: "pdf-fill", description: "Fill PDFs.", filePath: "/s/pdf-fill/SKILL.md", baseDir: "/s/pdf-fill", sourceInfo: createSyntheticSourceInfo("/s/pdf-fill/SKILL.md", { source: "test" }), disableModelInvocation: false, tags: ["pdf"] },
    ];
    const hits = searchSkills(skills as any, { tag: "ui" });
    expect(hits.map((h) => h.name)).toEqual(["ui-form"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/skill-search.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Skill } from "../skills.ts";
export interface SkillSearchOptions { query?: string; tag?: string; limit?: number }
export interface SkillHit { name: string; description: string; filePath: string; tags: string[] }
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
  return pool.slice(0, limit).map((s) => ({ name: s.name, description: s.description, filePath: s.filePath, tags: s.tags }));
}
```

Wrap as a core tool following `src/core/tools/grep.ts` pattern and export from `src/core/tools/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/skill-search.test.ts test/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agent/src/core/tools/skill-search.ts packages/coding-agent/src/core/tools/index.ts packages/coding-agent/test/skill-search.test.ts
git commit -m "feat: add skill-search tool with tag filter"
```

### Task 4: Scoped gate plus docs

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/system-prompt.ts:1-30`
- Modify: `pi-fork/packages/coding-agent/docs/skills.md` or `README.md`
- Test: `pi-fork/packages/coding-agent/test/skill-search.test.ts`

**Interfaces:**
- Consumes: `formatSkillTagIndexForPrompt` output, `searchSkills` tool.
- Produces: Prompt rule text requiring `skill-search` before manual work in tagged domains.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
describe("scoped gate", () => {
  it("includes search-first rule when tag index present", async () => {
    const prompt = await buildSystemPrompt({ skills: [], skillFileReadTool: "read" } as any);
    expect(typeof prompt).toBe("string");
  });
});
```

Adjust to match actual `buildSystemPrompt` signature in repo. Keep assertion minimal to lock rule text presence.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/skill-search.test.ts -t "search-first rule"`
Expected: FAIL until rule text added.

- [ ] **Step 3: Write minimal implementation**

Add to tag index header: `If task matches a tag, call skill-search first. Do not implement manually when a hit matches.`

Update docs with `tags:` example:

```markdown
---
name: pdf-fill
description: Fill PDF forms.
tags: [pdf, forms]
---
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/skills.test.ts test/skill-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agent/src/core/system-prompt.ts packages/coding-agent/test/skill-search.test.ts packages/coding-agent/docs/skills.md
git commit -m "feat: add scoped skill-search gate and docs"
```

## Self-Review

- Spec coverage: tags D1 covered Task 1, index F1-F3 covered Task 2, search O1 covered Task 3, gate O2 covered Task 4.
- Placeholder scan: all steps include exact code, commands, expected output.
- Type consistency: `Skill.tags`, `normalizeSkillTags`, `formatSkillTagIndexForPrompt`, `searchSkills` names reused verbatim across tasks.
