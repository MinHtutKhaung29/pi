import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { Skill } from "../skills.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

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
		async execute(_toolCallId, { query, tag, limit }: Static<typeof skillSearchSchema>) {
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
