import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { type CreateAgentSessionOptions, createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createHarness } from "./suite/harness.ts";

function createTestSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "pdf-fill",
		description: "Fill PDF forms with instructions.",
		filePath: "/path/to/pdf-fill/SKILL.md",
		baseDir: "/path/to/pdf-fill",
		sourceInfo: createSyntheticSourceInfo("/path/to/pdf-fill/SKILL.md", { source: "test" }),
		disableModelInvocation: false,
		tags: ["pdf", "forms"],
		...overrides,
	};
}

function createMockResourceLoader(skills: Skill[] = []): ResourceLoader {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		}),
		getSkills: () => ({ skills, diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

describe("skill-search conditional activation and registration", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-skill-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSession(
		skills: Skill[],
		options: Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools"> = {},
	) {
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = createMockResourceLoader(skills);

		return (
			await createAgentSession({
				cwd: tempDir,
				agentDir,
				model: getModel("anthropic", "claude-sonnet-4-5")!,
				settingsManager,
				sessionManager: SessionManager.inMemory(tempDir),
				resourceLoader,
				...options,
			})
		).session;
	}

	it("activates and registers skill-search by default when model-invocable skills exist", async () => {
		const skills = [
			createTestSkill({ name: "pdf-fill", disableModelInvocation: false }),
			createTestSkill({ name: "git-review", disableModelInvocation: false }),
		];
		const session = await createSession(skills);

		const registeredTools = session.getAllTools().map((t) => t.name);
		expect(registeredTools).toContain("skill-search");

		const activeTools = session.getActiveToolNames();
		expect(activeTools).toContain("skill-search");
		expect(activeTools).toEqual(["read", "bash", "edit", "write", "skill-search"]);

		// Lazy catalog prompt is rendered when skill-search is active
		expect(session.systemPrompt).toContain("Use skill-search to find relevant skills");
		expect(session.systemPrompt).not.toContain("<available_skills>");

		session.dispose();
	});

	it("does not register or activate skill-search when no skills exist", async () => {
		const session = await createSession([]);

		const registeredTools = session.getAllTools().map((t) => t.name);
		expect(registeredTools).not.toContain("skill-search");

		const activeTools = session.getActiveToolNames();
		expect(activeTools).not.toContain("skill-search");
		expect(activeTools).toEqual(["read", "bash", "edit", "write"]);

		expect(session.systemPrompt).not.toContain("Use skill-search to find relevant skills");
		expect(session.systemPrompt).not.toContain("- skill-search:");

		session.dispose();
	});

	it("registers but does not activate skill-search by default when all skills have disable-model-invocation", async () => {
		const skills = [
			createTestSkill({ name: "hidden-1", disableModelInvocation: true }),
			createTestSkill({ name: "hidden-2", disableModelInvocation: true }),
		];
		const session = await createSession(skills);

		const registeredTools = session.getAllTools().map((t) => t.name);
		expect(registeredTools).toContain("skill-search");

		const activeTools = session.getActiveToolNames();
		expect(activeTools).not.toContain("skill-search");
		expect(activeTools).toEqual(["read", "bash", "edit", "write"]);

		session.dispose();
	});

	describe("explicit --tools filtering", () => {
		it("excludes skill-search when explicit tools list omits it despite skills existing", async () => {
			const skills = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			const session = await createSession(skills, { tools: ["read", "bash"] });

			const registeredTools = session.getAllTools().map((t) => t.name);
			expect(registeredTools).toContain("read");
			expect(registeredTools).toContain("bash");
			expect(registeredTools).not.toContain("skill-search");

			const activeTools = session.getActiveToolNames();
			expect(activeTools).toEqual(["read", "bash"]);
			expect(activeTools).not.toContain("skill-search");

			session.dispose();
		});

		it("includes skill-search when explicit tools list includes it", async () => {
			const skills = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			const session = await createSession(skills, { tools: ["read", "skill-search"] });

			const registeredTools = session.getAllTools().map((t) => t.name);
			expect(registeredTools).toContain("skill-search");

			const activeTools = session.getActiveToolNames();
			expect(activeTools).toEqual(["read", "skill-search"]);

			session.dispose();
		});

		it("allows explicitly activating skill-search when all skills have disable-model-invocation", async () => {
			const skills = [createTestSkill({ name: "hidden", disableModelInvocation: true })];
			const session = await createSession(skills, { tools: ["read", "skill-search"] });

			const activeTools = session.getActiveToolNames();
			expect(activeTools).toEqual(["read", "skill-search"]);

			session.dispose();
		});

		it("does not register or activate skill-search when no skills exist even if explicitly requested in tools", async () => {
			const session = await createSession([], { tools: ["read", "skill-search"] });

			const registeredTools = session.getAllTools().map((t) => t.name);
			expect(registeredTools).not.toContain("skill-search");

			const activeTools = session.getActiveToolNames();
			expect(activeTools).not.toContain("skill-search");
			expect(activeTools).toEqual(["read"]);

			session.dispose();
		});

		it("respects excludeTools for skill-search when skills exist", async () => {
			const skills = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			const session = await createSession(skills, { excludeTools: ["skill-search"] });

			const registeredTools = session.getAllTools().map((t) => t.name);
			expect(registeredTools).not.toContain("skill-search");

			const activeTools = session.getActiveToolNames();
			expect(activeTools).not.toContain("skill-search");
			expect(activeTools).toEqual(["read", "bash", "edit", "write"]);

			session.dispose();
		});
	});

	describe("direct AgentSession instantiation via harness", () => {
		async function createDirectSession(skills: Skill[], initialActiveToolNames?: string[]) {
			const resourceLoader = createMockResourceLoader(skills);
			const harness = await createHarness({
				resourceLoader,
				initialActiveToolNames,
			});
			return harness;
		}

		it("activates skill-search by default when model-invocable skills exist", async () => {
			const skills = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			const harness = await createDirectSession(skills);

			expect(harness.session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(harness.session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write", "skill-search"]);
			harness.cleanup();
		});

		it("does not register or activate skill-search when no skills exist", async () => {
			const harness = await createDirectSession([]);

			expect(harness.session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(harness.session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write"]);
			harness.cleanup();
		});

		it("does not activate skill-search by default when all skills have disable-model-invocation", async () => {
			const skills = [createTestSkill({ name: "hidden", disableModelInvocation: true })];
			const harness = await createDirectSession(skills);

			expect(harness.session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(harness.session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write"]);
			harness.cleanup();
		});
	});
});
