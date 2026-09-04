import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
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

	describe("dynamic discovery, reload, and explicit exclusions", () => {
		async function createDiscoveringSession(
			options: {
				initialSkills?: Skill[];
				discoveredSkills?: Skill[];
				sessionOptions?: Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools">;
				settingsManager?: SettingsManager;
				baseToolsOverride?: Record<string, AgentTool>;
			} = {},
		) {
			let currentSkills = [...(options.initialSkills ?? [])];
			const settingsManager = options.settingsManager ?? SettingsManager.inMemory();
			const runtime = createExtensionRuntime();
			const extension = await loadExtensionFromFactory(
				(pi) => {
					pi.on("resources_discover", () => ({
						skillPaths: (options.discoveredSkills ?? []).map((s) => s.filePath),
					}));
				},
				tempDir,
				createEventBus(),
				runtime,
			);

			const resourceLoader: ResourceLoader = {
				getExtensions: () => ({
					extensions: [extension],
					errors: [],
					runtime,
				}),
				getSkills: () => ({ skills: currentSkills, diagnostics: [] }),
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getThemes: () => ({ themes: [], diagnostics: [] }),
				getAgentsFiles: () => ({ agentsFiles: [] }),
				getSystemPrompt: () => undefined,
				getSystemPromptSource: () => undefined,
				getAppendSystemPrompt: () => [],
				getAppendSystemPromptSources: () => [],
				extendResources: () => {
					currentSkills = [...currentSkills, ...(options.discoveredSkills ?? [])];
				},
				reload: async () => {},
			};

			const session = (
				await createAgentSession({
					cwd: tempDir,
					agentDir,
					model: getModel("anthropic", "claude-sonnet-4-5")!,
					settingsManager,
					sessionManager: SessionManager.inMemory(tempDir),
					resourceLoader,
					baseToolsOverride: options.baseToolsOverride,
					...options.sessionOptions,
				})
			).session;

			return {
				session,
				bind: async () => {
					await session.bindExtensions({
						shutdownHandler: () => {},
					});
				},
			};
		}

		it("Q1: resources_discover adds model-invocable skill: registers and activates, prompt is lazy, executing finds it", async () => {
			const discovered = createTestSkill({ name: "pdf-fill", disableModelInvocation: false });
			const { session, bind } = await createDiscoveringSession({
				initialSkills: [],
				discoveredSkills: [discovered],
			});

			expect(session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(session.getActiveToolNames()).not.toContain("skill-search");

			await bind();

			expect(session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(session.getActiveToolNames()).toContain("skill-search");
			expect(session.systemPrompt).toContain("Use skill-search to find relevant skills");

			const tool = session.agent.state.tools.find((t) => t.name === "skill-search")!;
			const result = await tool.execute("call-1", { query: "pdf" });
			expect((result.content[0] as { type: string; text: string }).text).toContain("pdf-fill");

			session.dispose();
		});

		it("Q2: resources_discover with tools: ['read']: stays unregistered/disabled and falls back to full catalog", async () => {
			const discovered = createTestSkill({ name: "pdf-fill", disableModelInvocation: false });
			const { session, bind } = await createDiscoveringSession({
				initialSkills: [],
				discoveredSkills: [discovered],
				sessionOptions: { tools: ["read"] },
			});

			await bind();

			expect(session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(session.getActiveToolNames()).toEqual(["read"]);
			expect(session.systemPrompt).toContain("<available_skills>");
			expect(session.systemPrompt).not.toContain("Use skill-search to find relevant skills");

			session.dispose();
		});

		it("Q3: resources_discover with excludeTools: ['skill-search']: stays unregistered/disabled and falls back to full catalog", async () => {
			const discovered = createTestSkill({ name: "pdf-fill", disableModelInvocation: false });
			const { session, bind } = await createDiscoveringSession({
				initialSkills: [],
				discoveredSkills: [discovered],
				sessionOptions: { excludeTools: ["skill-search"] },
			});

			await bind();

			expect(session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(session.getActiveToolNames()).not.toContain("skill-search");
			expect(session.systemPrompt).toContain("<available_skills>");
			expect(session.systemPrompt).not.toContain("Use skill-search to find relevant skills");

			session.dispose();
		});

		it("Q4: resources_discover with tools: ['read', 'skill-search'] and hidden skill: registered and active by explicit policy", async () => {
			const discovered = createTestSkill({ name: "hidden", disableModelInvocation: true });
			const { session, bind } = await createDiscoveringSession({
				initialSkills: [],
				discoveredSkills: [discovered],
				sessionOptions: { tools: ["read", "skill-search"] },
			});

			await bind();

			expect(session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(session.getActiveToolNames()).toEqual(["read", "skill-search"]);

			session.dispose();
		});

		it("Q5: resources_discover with defaultTools: ['read']: does not auto-add search", async () => {
			const discovered = createTestSkill({ name: "pdf-fill", disableModelInvocation: false });
			const settingsManager = SettingsManager.inMemory({ defaultTools: ["read"] });

			const { session, bind } = await createDiscoveringSession({
				initialSkills: [],
				discoveredSkills: [discovered],
				settingsManager,
			});

			await bind();

			expect(session.getActiveToolNames()).toEqual(["read"]);
			expect(session.systemPrompt).toContain("<available_skills>");
			expect(session.systemPrompt).not.toContain("Use skill-search to find relevant skills");

			session.dispose();
		});

		it("Q6: reload from no skills to one visible skill activates search; reload back to no skills unregisters it", async () => {
			let currentSkills: Skill[] = [];
			const resourceLoader: ResourceLoader = {
				getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
				getSkills: () => ({ skills: currentSkills, diagnostics: [] }),
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

			const session = (
				await createAgentSession({
					cwd: tempDir,
					agentDir,
					model: getModel("anthropic", "claude-sonnet-4-5")!,
					settingsManager: SettingsManager.inMemory(),
					sessionManager: SessionManager.inMemory(tempDir),
					resourceLoader,
				})
			).session;

			expect(session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(session.getActiveToolNames()).not.toContain("skill-search");

			// Reload with one visible skill
			currentSkills = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			await session.reload();

			expect(session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(session.getActiveToolNames()).toContain("skill-search");
			expect(session.systemPrompt).toContain("Use skill-search to find relevant skills");

			// Reload back to no skills
			currentSkills = [];
			await session.reload();

			expect(session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(session.getActiveToolNames()).not.toContain("skill-search");
			expect(session.systemPrompt).not.toContain("Use skill-search to find relevant skills");

			session.dispose();
		});

		it("Q7: manual disable preserved across reload when skills remain present", async () => {
			const currentSkills: Skill[] = [createTestSkill({ name: "pdf-fill", disableModelInvocation: false })];
			const resourceLoader: ResourceLoader = {
				getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
				getSkills: () => ({ skills: currentSkills, diagnostics: [] }),
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

			const session = (
				await createAgentSession({
					cwd: tempDir,
					agentDir,
					model: getModel("anthropic", "claude-sonnet-4-5")!,
					settingsManager: SettingsManager.inMemory(),
					sessionManager: SessionManager.inMemory(tempDir),
					resourceLoader,
				})
			).session;

			expect(session.getActiveToolNames()).toContain("skill-search");

			// User manually disables skill-search
			session.setActiveToolsByName(["read", "bash", "edit", "write"]);
			expect(session.getActiveToolNames()).not.toContain("skill-search");

			// Reload while skills still present
			await session.reload();

			expect(session.getAllTools().map((t) => t.name)).toContain("skill-search");
			expect(session.getActiveToolNames()).not.toContain("skill-search");

			session.dispose();
		});

		it("Q8: baseToolsOverride without skill-search never synthesizes it", async () => {
			const dummyTool: AgentTool = {
				name: "dummy",
				description: "A dummy tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [] }),
			};

			const harness = await createHarness({
				resourceLoader: createMockResourceLoader([createTestSkill()]),
				tools: [dummyTool],
			});

			expect(harness.session.getAllTools().map((t) => t.name)).not.toContain("skill-search");
			expect(harness.session.getActiveToolNames()).toEqual(["dummy"]);

			harness.cleanup();
		});
	});
});
