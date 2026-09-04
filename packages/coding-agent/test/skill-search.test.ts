import { resolve } from "path";
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
