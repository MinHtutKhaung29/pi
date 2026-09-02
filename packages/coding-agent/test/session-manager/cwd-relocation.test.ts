import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultSessionDir, SessionManager } from "../../src/core/session-manager.ts";

function persistConversation(session: SessionManager): void {
	session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
	session.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	});
	session.appendSessionInfo("named session");
}

describe("SessionManager.prepareCwdRelocation", () => {
	let root: string;
	let sourceCwd: string;
	let targetCwd: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		root = join(tmpdir(), `pi-cwd-relocation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		sourceCwd = join(root, "source");
		targetCwd = join(root, "target");
		mkdirSync(sourceCwd, { recursive: true });
		mkdirSync(targetCwd, { recursive: true });
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	});

	it("stages the same session in the target default directory and commits source removal", () => {
		const source = SessionManager.create(sourceCwd);
		persistConversation(source);
		const sourceFile = source.getSessionFile()!;
		const sourceEntries = source.getEntries();

		const relocation = source.prepareCwdRelocation(targetCwd);
		const targetFile = relocation.sessionManager.getSessionFile()!;

		expect(relocation.sessionManager.getCwd()).toBe(targetCwd);
		expect(relocation.sessionManager.getSessionId()).toBe(source.getSessionId());
		expect(relocation.sessionManager.getSessionName()).toBe("named session");
		expect(relocation.sessionManager.getEntries()).toEqual(sourceEntries);
		expect(targetFile).toBe(join(getDefaultSessionDir(targetCwd), basename(sourceFile)));
		expect(existsSync(sourceFile)).toBe(true);
		expect(existsSync(targetFile)).toBe(true);
		expect(JSON.parse(readFileSync(targetFile, "utf8").split("\n")[0]).cwd).toBe(targetCwd);

		relocation.commit();
		relocation.commit();
		expect(existsSync(sourceFile)).toBe(false);
		expect(existsSync(targetFile)).toBe(true);
	});

	it("rolls back the staged target without changing the source", () => {
		const source = SessionManager.create(sourceCwd);
		persistConversation(source);
		const sourceFile = source.getSessionFile()!;
		const relocation = source.prepareCwdRelocation(targetCwd);
		const targetFile = relocation.sessionManager.getSessionFile()!;

		relocation.rollback();
		relocation.rollback();

		expect(existsSync(sourceFile)).toBe(true);
		expect(existsSync(targetFile)).toBe(false);
	});

	it("keeps an explicit session directory while replacing the transcript file", () => {
		const explicitDir = join(root, "sessions");
		const source = SessionManager.create(sourceCwd, explicitDir);
		persistConversation(source);
		const sourceFile = source.getSessionFile()!;

		const relocation = source.prepareCwdRelocation(targetCwd);
		const targetFile = relocation.sessionManager.getSessionFile()!;

		expect(relocation.sessionManager.getSessionDir()).toBe(explicitDir);
		expect(targetFile).not.toBe(sourceFile);
		expect(targetFile.startsWith(explicitDir)).toBe(true);
		relocation.commit();
		expect(existsSync(sourceFile)).toBe(false);
		expect(existsSync(targetFile)).toBe(true);
	});

	it("relocates in-memory sessions without writing files", () => {
		const source = SessionManager.inMemory(sourceCwd);
		source.appendMessage({ role: "user", content: "hello", timestamp: 1 });

		const relocation = source.prepareCwdRelocation(targetCwd);

		expect(relocation.sessionManager.getCwd()).toBe(targetCwd);
		expect(relocation.sessionManager.getSessionId()).toBe(source.getSessionId());
		expect(relocation.sessionManager.getEntries()).toEqual(source.getEntries());
		expect(relocation.sessionManager.isPersisted()).toBe(false);
		expect(relocation.sessionManager.getSessionFile()).toBeUndefined();
		relocation.commit();
		relocation.rollback();
	});

	it("refuses to overwrite a session at the destination", () => {
		const source = SessionManager.create(sourceCwd);
		persistConversation(source);
		const targetFile = join(getDefaultSessionDir(targetCwd), basename(source.getSessionFile()!));
		mkdirSync(getDefaultSessionDir(targetCwd), { recursive: true });
		writeFileSync(targetFile, "existing");

		expect(() => source.prepareCwdRelocation(targetCwd)).toThrow(/destination already exists/i);
		expect(readFileSync(targetFile, "utf8")).toBe("existing");
	});

	it("returns a no-op relocation for the current directory", () => {
		const source = SessionManager.inMemory(sourceCwd);
		const relocation = source.prepareCwdRelocation(sourceCwd);

		expect(relocation.sessionManager).toBe(source);
		relocation.commit();
		relocation.rollback();
	});
});
