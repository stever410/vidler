#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { render } from "ink";
import meow from "meow";
import App from "./app.js";
import { BinaryManager } from "./core/binary-manager.js";
import { InvalidInputError, toExitCode } from "./core/errors.js";
import { createRuntime } from "./core/runtime.js";
import type { DownloadJob, DownloadRequest } from "./core/types.js";
import { createYtDlpStrategySet } from "./strategies/yt-dlp.js";
import { ensureOutputDir } from "./utils/fs.js";
import { detectProvider, parseHttpUrl } from "./utils/url-detect.js";

const cli = meow(
	`
	Usage
	  $ vidler [url] [options]

	Options
	  --quality <value>      best|worst|720p|1080p... (default: best)
	  --output <dir>         Output directory (default: ./output)
	  --filename <template>  Optional output filename template
	  --concurrency <n>      Worker pool size (default: 4)
	  --retries <n>          Retry attempts (default: 3)
	  --timeout <sec>        Per-attempt timeout in seconds
	  --no-progress          Disable Ink live progress UI
	  --json                 Emit JSON events/results
	  --verbose              Verbose logs

	Examples
	  $ vidler "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
	  $ vidler "https://www.tiktok.com/@user/video/123" --quality 720p --output ./videos
	`,
	{
		importMeta: import.meta,
		flags: {
			quality: {
				type: "string",
				default: "best",
			},
			output: {
				type: "string",
				default: "./output",
			},
			filename: {
				type: "string",
			},
			concurrency: {
				type: "number",
				default: 4,
			},
			retries: {
				type: "number",
				default: 3,
			},
			timeout: {
				type: "number",
			},
			progress: {
				type: "boolean",
				default: true,
			},
			json: {
				type: "boolean",
				default: false,
			},
			verbose: {
				type: "boolean",
				default: false,
			},
		},
	},
);

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = toExitCode(error);
}

async function main(): Promise<void> {
	printStartupBanner(await getCliVersion());

	if (cli.input.length > 1) {
		throw new InvalidInputError(
			"Expected at most one URL argument: vidler [url] [options]",
		);
	}

	const request = await resolveRequestFromInput();
	const provider = detectProvider(new URL(request.url));

	const job: DownloadJob = {
		id: `job-${Date.now()}`,
		request,
		detectedProvider: provider,
	};

	const binaryManager = new BinaryManager();
	const binaryPaths = await binaryManager.ensureBinaries(cli.flags.verbose);

	const strategySet = createYtDlpStrategySet(binaryPaths);
	const runtime = createRuntime({
		jobs: [job],
		strategies: strategySet.strategies,
		fallback: strategySet.fallback,
		concurrency: Math.max(1, Math.floor(cli.flags.concurrency)),
		retries: request.retries,
	});

	if (cli.flags.json || !cli.flags.progress || !process.stdout.isTTY) {
		attachHeadlessOutput(runtime, cli.flags.json);
		const results = await runtime.start();
		if (results.some((result) => !result.success)) {
			process.exitCode = 1;
		}
		return;
	}

	console.clear();
	const ui = render(<App runtime={runtime} />);
	await ui.waitUntilExit();
}

async function getCliVersion(): Promise<string> {
	const { npm_package_version: envVersion } = process.env;
	if (envVersion) {
		return envVersion;
	}

	try {
		const packageJsonPath = new URL("../package.json", import.meta.url);
		const raw = await readFile(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as { version?: string };
		return parsed.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function printStartupBanner(version: string): void {
	const bannerLines = String.raw`
__     ___ ____  _     _____ ____
\ \   / (_)  _ \| |   | ____|  _ \
 \ \ / /| | | | | |   |  _| | |_) |
  \ V / | | |_| | |___| |___|  _ <
   \_/  |_|____/|_____|_____|_| \_\
`
		.trim()
		.split("\n");

	const gradient = [
		[255, 120, 0],
		[255, 150, 40],
		[255, 180, 80],
		[255, 205, 120],
		[255, 230, 170],
	] as const;
	const fallbackColor: readonly [number, number, number] = [255, 230, 170];

	for (const [index, line] of bannerLines.entries()) {
		const color = gradient[index] ?? fallbackColor;
		const [r, g, b] = color;
		console.log(chalk.rgb(r, g, b).bold(line));
	}

	console.log(chalk.rgb(255, 176, 80)(`vidler v${version}`));
	console.log(
		chalk.rgb(
			145,
			170,
			205,
		)(
			"Multi-site terminal video downloader with interactive setup and live progress.",
		),
	);
	console.log("");
}

async function resolveRequestFromInput(): Promise<DownloadRequest> {
	const retries = Math.max(0, Math.floor(cli.flags.retries));
	const timeoutSec = cli.flags.timeout
		? Math.max(1, Math.floor(cli.flags.timeout))
		: undefined;

	if (cli.input.length === 1) {
		const inputUrl = cli.input[0];
		if (!inputUrl) {
			throw new InvalidInputError("Missing URL argument");
		}

		const parsedUrl = parseHttpUrl(inputUrl);
		const outputDir = await ensureOutputDir(cli.flags.output);
		return {
			url: parsedUrl.toString(),
			quality: cli.flags.quality,
			outputDir,
			filenameTemplate: cli.flags.filename,
			retries,
			timeoutSec,
		};
	}

	if (!process.stdin.isTTY || cli.flags.json) {
		throw new InvalidInputError(
			"URL is required in non-interactive mode: vidler <url> [options]",
		);
	}

	return promptInteractiveRequest({
		quality: cli.flags.quality,
		output: cli.flags.output,
		filename: cli.flags.filename,
		retries,
		timeoutSec,
	});
}

type InteractiveDefaults = {
	quality: string;
	output: string;
	filename?: string;
	retries: number;
	timeoutSec?: number;
};

async function promptInteractiveRequest(
	defaults: InteractiveDefaults,
): Promise<DownloadRequest> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		console.clear();
		console.log("vidler interactive setup");
		console.log("");

		const inputUrl = await askRequired(rl, "Video URL", "");
		const parsedUrl = parseHttpUrl(inputUrl);

		const quality = await askWithDefault(
			rl,
			"Quality (best, worst, 720p, 1080p)",
			defaults.quality,
		);
		const output = await askWithDefault(
			rl,
			"Output directory",
			defaults.output,
		);
		const filenameTemplateRaw = await askWithDefault(
			rl,
			"Filename template (blank for default)",
			defaults.filename ?? "",
		);

		const outputDir = await ensureOutputDir(output);

		return {
			url: parsedUrl.toString(),
			quality: quality.trim() || "best",
			outputDir,
			filenameTemplate: filenameTemplateRaw.trim() || undefined,
			retries: defaults.retries,
			timeoutSec: defaults.timeoutSec,
		};
	} finally {
		rl.close();
	}
}

async function askWithDefault(
	rl: ReturnType<typeof createInterface>,
	label: string,
	defaultValue: string,
): Promise<string> {
	const answer = await rl.question(
		`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `,
	);
	const trimmed = answer.trim();
	return trimmed || defaultValue;
}

async function askRequired(
	rl: ReturnType<typeof createInterface>,
	label: string,
	defaultValue: string,
): Promise<string> {
	for (;;) {
		const value = await askWithDefault(rl, label, defaultValue);
		if (value.trim()) {
			return value.trim();
		}
		console.log(`${label} is required.`);
	}
}

function attachHeadlessOutput(
	runtime: ReturnType<typeof createRuntime>,
	asJson: boolean,
): void {
	const out = (event: string, payload: unknown) => {
		if (asJson) {
			console.log(JSON.stringify({ event, ...toObject(payload) }));
			return;
		}

		console.log(formatPlainEvent(event, payload));
	};

	runtime.pool.on("jobStarted", (payload) => out("jobStarted", payload));
	runtime.pool.on("jobProgress", (payload) => out("jobProgress", payload));
	runtime.pool.on("jobRetry", (payload) => out("jobRetry", payload));
	runtime.pool.on("jobCompleted", (payload) => out("jobCompleted", payload));
	runtime.pool.on("jobFailed", (payload) => out("jobFailed", payload));
}

function toObject(input: unknown): Record<string, unknown> {
	if (typeof input === "object" && input !== null) {
		return input as Record<string, unknown>;
	}
	return { value: input };
}

function formatPlainEvent(event: string, payload: unknown): string {
	const record = toPlainEventRecord(payload);
	if (event === "jobProgress") {
		const progress = record.progress;
		const pct =
			progress?.percent !== undefined
				? `${progress.percent.toFixed(1)}%`
				: "n/a";
		return `[${event}] ${record.jobId ?? "unknown"} status=${progress?.status ?? "unknown"} percent=${pct}`;
	}

	if (event === "jobRetry") {
		return `[${event}] ${record.jobId ?? "unknown"} attempt=${record.attempt ?? "unknown"} reason=${record.reason ?? "unknown"}`;
	}

	if (event === "jobFailed") {
		const result = record.result;
		return `[${event}] ${record.jobId ?? "unknown"} error=${result?.errorMessage ?? "unknown"}`;
	}

	if (event === "jobCompleted") {
		const result = record.result;
		return `[${event}] ${record.jobId ?? "unknown"} file=${result?.filePath ?? "unknown"}`;
	}

	return `[${event}] ${JSON.stringify(toObject(payload))}`;
}

type PlainEventRecord = {
	jobId?: string;
	attempt?: number;
	reason?: string;
	progress?: { percent?: number; status?: string };
	result?: { errorMessage?: string; filePath?: string };
};

function toPlainEventRecord(input: unknown): PlainEventRecord {
	if (typeof input === "object" && input !== null) {
		return input as PlainEventRecord;
	}

	return {};
}
