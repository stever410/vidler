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
	  --concurrency <n>      Deprecated in v1 (forced to 1)
	  --retries <n>          Retry attempts (default: 3)
	  --timeout <sec>        Per-attempt timeout in seconds
	  --show-log             Show yt-dlp logs while downloading
	  --no-progress          Disable Ink live progress UI
	  --json                 Emit machine-readable output
	  --verbose              Verbose logs

	Examples
	  $ vidler "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
	  $ vidler "https://www.tiktok.com/@user/video/123" --quality 720p --output ./videos
	  $ vidler "<url>" --show-log
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
				default: 1,
			},
			retries: {
				type: "number",
				default: 3,
			},
			timeout: {
				type: "number",
			},
			showLog: {
				type: "boolean",
				default: false,
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

type InteractiveDefaults = {
	quality: string;
	output: string;
	filename?: string;
	retries: number;
	timeoutSec?: number;
};

type QualityOption = {
	value: string;
	label: string;
};

const BASE_QUALITY_OPTIONS: QualityOption[] = [
	{ value: "best", label: "Best available (recommended)" },
	{ value: "1080p", label: "1080p (Full HD)" },
	{ value: "720p", label: "720p (HD)" },
	{ value: "480p", label: "480p (SD)" },
	{ value: "360p", label: "360p (Data saver)" },
	{ value: "worst", label: "Smallest file size" },
];

async function main(): Promise<void> {
	printStartupBanner(await getCliVersion());

	if (cli.input.length > 1) {
		throw new InvalidInputError(
			"Expected at most one URL argument: vidler [url] [options]",
		);
	}
	if (Math.floor(cli.flags.concurrency) !== 1) {
		console.error(
			chalk.yellow(
				"--concurrency is deprecated in v1. Vidler now runs with a single worker.",
			),
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
		concurrency: 1,
		retries: request.retries,
		emitLogs: cli.flags.showLog,
	});

	if (cli.flags.json || !cli.flags.progress || !process.stdout.isTTY) {
		attachHeadlessOutput(runtime, cli.flags.json, cli.flags.showLog);
		const results = await runtime.start();
		if (results.some((result) => !result.success)) {
			process.exitCode = 1;
		}
		return;
	}

	console.clear();
	const ui = render(<App runtime={runtime} showLogs={cli.flags.showLog} />);
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
	const versionLine = chalk.rgb(255, 176, 80)(`vidler v${version}`);
	const descriptionLine = chalk.rgb(
		145,
		170,
		205,
	)("Your all-in-one command center for fast, high-quality video downloads.");

	for (const [index, line] of bannerLines.entries()) {
		const color = gradient[index] ?? fallbackColor;
		const [r, g, b] = color;
		const bannerLine = chalk.rgb(r, g, b).bold(line);
		if (index === 2) {
			console.log(`${bannerLine}   ${versionLine}`);
			continue;
		}
		if (index === 3) {
			console.log(`${bannerLine}   ${descriptionLine}`);
			continue;
		}
		console.log(bannerLine);
	}
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
			"Please add a video link: vidler <url> [options]",
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

async function promptInteractiveRequest(
	defaults: InteractiveDefaults,
): Promise<DownloadRequest> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		console.log("✨ Quick setup");
		console.log("-----------------");

		const parsedUrl = await askForValidUrl(rl);
		const quality = await askForValidQuality(rl, defaults.quality);
		const outputDir = await askForValidOutputDir(rl, defaults.output);
		const filenameTemplateRaw = await askWithDefault(
			rl,
			"🏷️ Want a custom file name format (leave blank for auto)",
			defaults.filename ?? "",
		);

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

async function askForValidUrl(
	rl: ReturnType<typeof createInterface>,
): Promise<URL> {
	for (;;) {
		const value = await askRequired(
			rl,
			"❓ What video would you like to download today",
			"",
		);
		try {
			return parseHttpUrl(value);
		} catch (error) {
			console.log(
				chalk.yellow(
					error instanceof Error
						? `${error.message}. Please try again.`
						: "That link is not valid. Please try again.",
				),
			);
		}
	}
}

async function askForValidQuality(
	rl: ReturnType<typeof createInterface>,
	defaultValue: string,
): Promise<string> {
	const options = withDefaultQualityOption(defaultValue);
	const defaultIndex = options.findIndex(
		(option) => option.value === normalizeQuality(defaultValue),
	);
	const safeDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;

	for (;;) {
		console.log("");
		console.log("🎬 Pick your video quality:");
		for (const [index, option] of options.entries()) {
			const marker = index === safeDefaultIndex ? "⭐" : " ";
			console.log(`  ${marker} ${index + 1}. ${option.label}`);
		}

		const answer = await rl.question(
			`Select a number [1-${options.length}] (default ${safeDefaultIndex + 1}): `,
		);
		const trimmed = answer.trim();
		if (trimmed.length === 0) {
			return options[safeDefaultIndex]?.value ?? "best";
		}

		const selected = Number(trimmed);
		if (
			Number.isInteger(selected) &&
			selected >= 1 &&
			selected <= options.length
		) {
			return options[selected - 1]?.value ?? "best";
		}

		console.log(chalk.yellow("Please select a valid number from the list."));
	}
}

async function askForValidOutputDir(
	rl: ReturnType<typeof createInterface>,
	defaultValue: string,
): Promise<string> {
	for (;;) {
		const value = await askWithDefault(
			rl,
			"📁 Where should we save it",
			defaultValue,
		);
		try {
			return await ensureOutputDir(value);
		} catch (error) {
			console.log(
				chalk.yellow(
					error instanceof Error
						? `${error.message}. Please try a different folder.`
						: "We could not use that folder. Please try a different one.",
				),
			);
		}
	}
}

function isValidQuality(value: string): boolean {
	const normalized = normalizeQuality(value);
	return (
		normalized === "best" ||
		normalized === "worst" ||
		/^\d{3,4}p$/.test(normalized)
	);
}

function normalizeQuality(value: string): string {
	return value.trim().toLowerCase();
}

function withDefaultQualityOption(defaultValue: string): QualityOption[] {
	const normalizedDefault = normalizeQuality(defaultValue);
	if (!isValidQuality(normalizedDefault)) {
		return BASE_QUALITY_OPTIONS;
	}

	if (
		BASE_QUALITY_OPTIONS.some((option) => option.value === normalizedDefault)
	) {
		return BASE_QUALITY_OPTIONS;
	}

	return [
		{
			value: normalizedDefault,
			label: `${normalizedDefault} (from your --quality setting)`,
		},
		...BASE_QUALITY_OPTIONS,
	];
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
	showLogs: boolean,
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

	if (showLogs) {
		runtime.pool.on("jobLog", (payload) => out("jobLog", payload));
	}
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

	if (event === "jobLog") {
		const stream = record.stream ?? "stdout";
		return `[${event}] ${record.jobId ?? "unknown"} ${stream}> ${record.message ?? ""}`;
	}

	return `[${event}] ${JSON.stringify(toObject(payload))}`;
}

type PlainEventRecord = {
	jobId?: string;
	attempt?: number;
	reason?: string;
	stream?: "stdout" | "stderr" | "system";
	message?: string;
	progress?: { percent?: number; status?: string };
	result?: { errorMessage?: string; filePath?: string };
};

function toPlainEventRecord(input: unknown): PlainEventRecord {
	if (typeof input === "object" && input !== null) {
		return input as PlainEventRecord;
	}

	return {};
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = toExitCode(error);
});
