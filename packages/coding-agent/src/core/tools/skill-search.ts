import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { Skill } from "../skills.ts";
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

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function isCjk(text: string): boolean {
	return CJK_REGEX.test(text);
}

function normalizeText(text: string): string {
	return text.normalize("NFKC").toLowerCase();
}

function tokenize(text: string): string[] {
	return normalizeText(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

function compareCodePoints(a: string, b: string): number {
	const normA = a.normalize("NFC");
	const normB = b.normalize("NFC");
	if (normA === normB) return 0;
	const charsA = Array.from(normA);
	const charsB = Array.from(normB);
	const len = Math.min(charsA.length, charsB.length);
	for (let i = 0; i < len; i++) {
		const cpA = charsA[i].codePointAt(0)!;
		const cpB = charsB[i].codePointAt(0)!;
		if (cpA !== cpB) {
			return cpA < cpB ? -1 : 1;
		}
	}
	return charsA.length - charsB.length;
}

export function searchSkills(skills: Skill[], opts: SkillSearchOptions): SkillHit[] {
	const tag = normalizeText(opts.tag ?? "").trim();
	const query = normalizeText(opts.query ?? "").trim();
	const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);

	let pool = skills.filter((s) => !s.disableModelInvocation);
	if (tag) pool = pool.filter((s) => s.tags.some((t) => normalizeText(t) === tag));

	if (!query) {
		return pool
			.slice()
			.sort((a, b) => compareCodePoints(a.name, b.name))
			.slice(0, limit)
			.map((s) => ({ name: s.name, description: s.description, filePath: s.filePath, tags: s.tags }));
	}

	const queryTokens = Array.from(new Set(tokenize(query)));

	const scored: Array<{
		skill: Skill;
		exactName: number;
		exactTag: number;
		tagTokenMatches: number;
		nameTokenMatches: number;
		descTokenMatches: number;
	}> = [];

	for (const s of pool) {
		const normalizedName = normalizeText(s.name);
		const normalizedTags = s.tags.map((t) => normalizeText(t));
		const normalizedDesc = normalizeText(s.description);

		const exactName = normalizedName === query ? 1 : 0;
		const exactTag = normalizedTags.some((t) => t === query) ? 1 : 0;

		const tagTokens = new Set(s.tags.flatMap((t) => tokenize(t)));
		let tagTokenMatches = 0;
		for (const q of queryTokens) {
			if (
				tagTokens.has(q) ||
				normalizedTags.some((t) => (isCjk(q) || isCjk(t)) && (t.includes(q) || q.includes(t)))
			) {
				tagTokenMatches++;
			}
		}

		const nameTokens = new Set(tokenize(s.name));
		let nameTokenMatches = 0;
		for (const q of queryTokens) {
			if (
				nameTokens.has(q) ||
				((isCjk(q) || isCjk(normalizedName)) && (normalizedName.includes(q) || q.includes(normalizedName)))
			) {
				nameTokenMatches++;
			}
		}

		const descTokens = new Set(tokenize(s.description));
		let descTokenMatches = 0;
		for (const q of queryTokens) {
			if (descTokens.has(q) || ((isCjk(q) || isCjk(normalizedDesc)) && normalizedDesc.includes(q))) {
				descTokenMatches++;
			}
		}

		if (!exactName && !exactTag && tagTokenMatches === 0 && nameTokenMatches === 0 && descTokenMatches === 0) {
			continue;
		}

		scored.push({
			skill: s,
			exactName,
			exactTag,
			tagTokenMatches,
			nameTokenMatches,
			descTokenMatches,
		});
	}

	scored.sort((a, b) => {
		if (b.exactName !== a.exactName) return b.exactName - a.exactName;
		if (b.exactTag !== a.exactTag) return b.exactTag - a.exactTag;
		if (b.tagTokenMatches !== a.tagTokenMatches) return b.tagTokenMatches - a.tagTokenMatches;
		if (b.nameTokenMatches !== a.nameTokenMatches) return b.nameTokenMatches - a.nameTokenMatches;
		if (b.descTokenMatches !== a.descTokenMatches) return b.descTokenMatches - a.descTokenMatches;
		return compareCodePoints(a.skill.name, b.skill.name);
	});

	return scored
		.slice(0, limit)
		.map(({ skill: s }) => ({ name: s.name, description: s.description, filePath: s.filePath, tags: s.tags }));
}

const skillSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Keywords, e.g. 'fill pdf form'" })),
	tag: Type.Optional(Type.String({ description: "Tag filter, e.g. 'pdf'. See <skill_tag_index>." })),
	limit: Type.Optional(Type.Integer({ description: "Max hits (default 5, max 10)", minimum: 1, maximum: 10 })),
});

function serializeSkillMetadata(value: string | string[]): string {
	return JSON.stringify(value).replace(
		/[\u2028\u2029]/g,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

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
				.map(
					(h) =>
						`- ${serializeSkillMetadata(h.name)}: ${serializeSkillMetadata(h.description)} (file: ${serializeSkillMetadata(h.filePath)}, tags: ${h.tags.length > 0 ? serializeSkillMetadata(h.tags) : "none"})`,
				)
				.join("\n");
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}

export function createSkillSearchTool(
	cwd: string,
	options?: SkillSearchToolOptions,
): AgentTool<typeof skillSearchSchema> {
	return wrapToolDefinition(createSkillSearchToolDefinition(cwd, options));
}
