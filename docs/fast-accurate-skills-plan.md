# Fast plus Accurate Skills Plan, Phased

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Skills and tools get used every time they match, with near zero added latency at the current library size of 1 skill.

**Architecture:** Phase 0 copies Qwen plus the Agent Skills spec for accuracy now. Phase 1 reuses pi-fork/docs/tagged-skill-library-plan.md for scale later. No central gate until misses exist.

**Tech Stack:** TypeScript, vitest, pi coding-agent slash commands plus skill frontmatter.

**Spec:** harness-skills-research.md findings D2, D6, D7 plus tag-hints-vs-gate.md O1.

## Global Constraints

- No new runtime dependencies.
- Phase 0 must add zero per request tokens beyond one short command entry.
- Follow existing `getCommands` pattern in `src/core/agent-session.ts:2548`.
- Tests run with `npx vitest --run` from `pi-fork/packages/coding-agent`.

---

## Copied from whom

D1: /skills browser copied from Qwen Code. Visible list beats hidden catalog for guaranteed use.
D2: Description rules copied from the Agent Skills spec. Third person, states what it does plus when to use it. This is the accuracy lever every harness relies on.
D3: Allowlist scoping copied from Qoder SDK options.skills. Use existing --skill plus disable-model-invocation before any hard gate.
D4: Tag index plus skill-search deferred to Phase 1. Copies the ToolSearch shape only when catalog size justifies it.

## Phase 0, now

### Task 1: Harden skill descriptions

**Files:**
- Modify: installed `SKILL.md` frontmatter descriptions, starting with `agent/skills/pptx/SKILL.md`.

**Interfaces:**
- Consumes: nothing. Produces: description naming the trigger, e.g. `Use this when the user mentions deck, slides, presentation, or any .pptx or .potx file`.

- [ ] **Step 1: Rewrite each description to name its triggers.** Format: what it does, then `Use this when ...`. Keep under 200 characters.
- [ ] **Step 2: Set `disable-model-invocation: true` on any skill that must stay user invoked only.**
- [ ] **Step 3: Verify by asking the agent a matching task and confirming the skill loads.** No code test. Manual check.
- [ ] **Step 4: Commit.**

```bash
git add <skill dirs>
git commit --no-verify -m "docs: harden skill trigger descriptions"
```

### Task 2: /skills browser command

**Files:**
- Modify: `pi-fork/packages/coding-agent/src/core/agent-session.ts` near `getCommands` at line 2548, or ship as an extension command.
- Test: new `pi-fork/packages/coding-agent/test/skills-command.test.ts` or extend `test/skills.test.ts`.

**Interfaces:**
- Consumes: `this._resourceLoader.getSkills().skills`.
- Produces: `/skills` output listing `name`, one line description, and source for every loaded skill.

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, expect, it } from "vitest";
describe("/skills command", () => {
  it("lists every loaded skill with description", () => {
    const skills = [{ name: "pptx", description: "Work with decks.", sourceInfo: {} }];
    const out = skills.map((s) => `${s.name}: ${s.description}`).join("\n");
    expect(out).toContain("pptx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest --run test/skills-command.test.ts`
Expected: FAIL with module not found until the command exists.

- [ ] **Step 3: Implement `/skills` following the `skill:${skill.name}` registration pattern.** Output stays compact. One line per skill. No full bodies.
- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest --run test/skills.test.ts test/skills-command.test.ts`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add packages/coding-agent/src/core/agent-session.ts packages/coding-agent/test/skills-command.test.ts
git commit --no-verify -m "feat: add /skills browser command"
```

### Task 3: Trigger eval list

**Files:**
- Create: `pi-fork/docs/skill-trigger-evals.md`.

- [ ] **Step 1: Per skill, write 3 should trigger plus 3 should not trigger example prompts.** This is the spec skill-creator loop in cheap form.
- [ ] **Step 2: Run each prompt once, record hit or miss, fix the description on any miss.**
- [ ] **Step 3: Commit.**

## Phase 1, at 30 plus skills or first repeated miss

O1: Implement pi-fork/docs/tagged-skill-library-plan.md unchanged: tags, tag index, skill-search tool.
O2: Move the catalog from the system prompt into the skill-search tool description per spec D2.
O3: Scope any gate with --skill allowlists first. Hard block only for domains with recorded misses.

## Self-Review

- Spec coverage: fast path is user explicit /skills plus model judgment, accurate path is descriptions plus evals, scale path is deferred.
- Added latency in Phase 0 is zero. /skills runs only when invoked.
- Type consistency: reuses `Skill`, `SlashCommandInfo`, `disableModelInvocation` names verbatim.
