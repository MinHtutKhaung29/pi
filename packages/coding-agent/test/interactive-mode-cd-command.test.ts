import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type CdCommandContext = {
	sessionManager: { getCwd: () => string };
	session: { waitForIdle: () => Promise<void> };
	runtimeHost: {
		changeCwd: (
			targetCwd: string,
			options: { projectTrustContextFactory: (cwd: string) => unknown },
		) => Promise<{ cancelled: boolean }>;
	};
	createProjectTrustContext: (cwd: string) => unknown;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	getCdCommandArgument: (text: string) => string | undefined;
};

type InteractiveModePrototype = {
	getCdCommandArgument(this: unknown, text: string): string | undefined;
	handleCdCommand(this: CdCommandContext, text: string): Promise<void>;
};

const prototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("InteractiveMode /cd", () => {
	it("advertises the built-in command", () => {
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "cd",
			description: "Change the current project directory",
			argumentHint: "<directory>",
		});
	});

	it.each([
		["/cd child", "child"],
		['/cd "folder with spaces"', "folder with spaces"],
		["/cd 'folder with spaces'", "folder with spaces"],
		["/cd C:\\work\\project", "C:\\work\\project"],
		["/cd folder with spaces", "folder with spaces"],
	])("parses %s", (text, expected) => {
		expect(prototype.getCdCommandArgument(text)).toBe(expected);
	});

	it("rejects missing arguments and command prefix collisions", () => {
		expect(prototype.getCdCommandArgument("/cd")).toBeUndefined();
		expect(prototype.getCdCommandArgument("/cdev other")).toBeUndefined();
		expect(prototype.getCdCommandArgument('/cd "unterminated')).toBeUndefined();
	});

	it("waits for idle and switches to the canonical directory with target trust", async () => {
		const source = join(tmpdir(), `pi-cd-source-${Date.now()}`);
		const target = join(source, "target");
		mkdirSync(target, { recursive: true });
		const waitForIdle = vi.fn(async () => {});
		const changeCwd = vi.fn(async () => ({ cancelled: false }));
		const createProjectTrustContext = vi.fn((cwd: string) => ({ cwd }));
		const showStatus = vi.fn();
		const showError = vi.fn();
		const context: CdCommandContext = {
			sessionManager: { getCwd: () => source },
			session: { waitForIdle },
			runtimeHost: { changeCwd },
			createProjectTrustContext,
			showStatus,
			showError,
			getCdCommandArgument: prototype.getCdCommandArgument,
		};

		await prototype.handleCdCommand.call(context, "/cd target");

		expect(waitForIdle).toHaveBeenCalledOnce();
		expect(changeCwd).toHaveBeenCalledWith(resolve(target), {
			projectTrustContextFactory: expect.any(Function),
		});
		const options = changeCwd.mock.calls[0]![1];
		expect(options.projectTrustContextFactory(resolve(target))).toEqual({ cwd: resolve(target) });
		expect(createProjectTrustContext).toHaveBeenCalledWith(resolve(target));
		expect(showStatus).toHaveBeenCalledWith(`Changed directory to: ${resolve(target)}`);
		expect(showError).not.toHaveBeenCalled();
	});

	it("rejects files without invoking the runtime", async () => {
		const source = join(tmpdir(), `pi-cd-file-${Date.now()}`);
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "file.txt"), "content");
		const changeCwd = vi.fn(async () => ({ cancelled: false }));
		const showError = vi.fn();
		const context: CdCommandContext = {
			sessionManager: { getCwd: () => source },
			session: { waitForIdle: vi.fn(async () => {}) },
			runtimeHost: { changeCwd },
			createProjectTrustContext: vi.fn(),
			showStatus: vi.fn(),
			showError,
			getCdCommandArgument: prototype.getCdCommandArgument,
		};

		await prototype.handleCdCommand.call(context, "/cd file.txt");

		expect(changeCwd).not.toHaveBeenCalled();
		expect(showError).toHaveBeenCalledWith(expect.stringContaining("not a directory"));
	});
});
