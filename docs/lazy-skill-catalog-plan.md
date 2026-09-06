# Lazy Skill Catalog Implementation Plan

**Goal:** Replace duplicated full skill descriptions with a compact discovery prompt plus on-demand `skill-search`, while keeping explicit `/skill:name` behavior.

**Architecture:** When `skill-search` is enabled and model-invocable skills exist, the prompt omits `<available_skills>` and emits only a compact instruction plus tag vocabulary. `skill-search` becomes active by default only in that case. Search returns descriptions and paths on demand. When the tool is disabled, Pi keeps the current full catalog as a compatibility fallback.

## Task 1: Prompt fallback switch

- Add `skillSearchEnabled?: boolean` to `formatSkillsForPrompt` and the system-prompt options path.
- RED: test that enabled mode omits descriptions and `<available_skills>` but includes the compact discovery instruction and tags.
- RED: test that disabled mode preserves current output exactly.
- GREEN: implement the conditional formatting.

## Task 2: Conditional default activation

- Add `skill-search` to active tool names when at least one model-invocable skill exists.
- Do not register or activate it when no skills exist.
- Respect explicit `--tools` filtering and `disable-model-invocation`.
- RED: agent-session tests for skills present, absent, all disabled, and explicit tools list.
- GREEN: implement the minimum activation logic.

## Task 3: Retrieval quality

- Keep tag filtering, but rank query results by exact name, tag, name token, then description token matches.
- Return a bounded maximum of 10 hits.
- RED: ranking and no-match tests.
- GREEN: minimal deterministic ranking.

## Task 4: Verification

- Run scoped skill, system-prompt, agent-session, and skill-search tests.
- Run `npm run hydrate:model-data` then a real non-interactive session.
- Capture prompt size before and after using identical fixture skills.
- Verify automatic search invocation for an indirect prompt such as `Fill this document form` and explicit `/skill:name` compatibility.
- Fresh Builder implementation, Reviewer-Sonnet correctness review, Reviewer-Sol security/token review.
