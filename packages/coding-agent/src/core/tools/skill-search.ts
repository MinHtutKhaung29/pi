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
