import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DownloadError } from "../core/errors.js";
import {
	parseYtDlpProgressLine,
	YT_DLP_PROGRESS_PREFIX,
} from "../core/progress-parser.js";
import {
	bindStrategyToProviders,
	type DownloadStrategy,
	type LogEmitter,
	type ProgressEmitter,
} from "../core/strategy.js";
import type {
	DownloadJob,
	DownloadResult,
	PreparedJob,
} from "../core/types.js";

export type YtDlpPaths = {
	ytDlpPath: string;
	ffmpegPath?: string;
};

export class YtDlpStrategy implements DownloadStrategy {
	readonly name: string = "yt-dlp";
	readonly #paths: YtDlpPaths;

	constructor(paths: YtDlpPaths) {
		this.#paths = paths;
	}

	canHandle(_job: DownloadJob): boolean {
		return true;
	}

	async prepare(job: DownloadJob): Promise<PreparedJob> {
		const args = this.#buildArgs(job);
		return {
			job,
			provider: job.detectedProvider,
			command: this.#paths.ytDlpPath,
			args,
		};
	}

	async download(
		prepared: PreparedJob,
		emit: ProgressEmitter,
		emitLog?: LogEmitter,
	): Promise<DownloadResult> {
		const startedAt = Date.now();
		const stderrLines: string[] = [];
		const destinationPath = { value: undefined as string | undefined };
		const timeoutMs = prepared.job.request.timeoutSec
			? prepared.job.request.timeoutSec * 1000
			: undefined;

		await new Promise<void>((resolve, reject) => {
			const child = spawn(prepared.command, prepared.args, {
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
			});

			let timeoutId: NodeJS.Timeout | undefined;
			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					child.kill("SIGTERM");
					reject(new DownloadError("Download timed out", true));
				}, timeoutMs);
			}

			const stdoutReader = createInterface({ input: child.stdout });
			stdoutReader.on("line", (line) => {
				emitLog?.({ stream: "stdout", message: line });

				const progress = parseYtDlpProgressLine(line);
				if (progress) {
					emit(progress);
				}

				const destinationMatch = line.match(
					/(?:\[download\] Destination:|\[Merger\] Merging formats into)\s+"?(.+?)"?$/,
				);
				if (destinationMatch) {
					destinationPath.value = destinationMatch[1];
				}
			});

			const stderrReader = createInterface({ input: child.stderr });
			stderrReader.on("line", (line) => {
				emitLog?.({ stream: "stderr", message: line });
				stderrLines.push(line);
			});

			child.on("error", (error) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				reject(new DownloadError(error.message, true));
			});

			child.on("close", (code) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}

				if (code === 0) {
					resolve();
					return;
				}

				const stderrSnippet = stderrLines.slice(-5).join("\n");
				reject(
					new DownloadError(
						buildYtDlpErrorMessage(code, stderrSnippet),
						isRetryableStderr(stderrSnippet),
						stderrSnippet,
					),
				);
			});
		});

		emit({ status: "completed", percent: 100 });

		return {
			jobId: prepared.job.id,
			success: true,
			provider: prepared.provider,
			filePath: destinationPath.value,
			durationMs: Date.now() - startedAt,
			attempts: 1,
		};
	}

	#buildArgs(job: DownloadJob): string[] {
		const outputTemplate = job.request.filenameTemplate
			? `${job.request.filenameTemplate}.%(ext)s`
			: "%(title).180B.%(ext)s";

		const args = [
			"--newline",
			"--progress",
			"--progress-delta",
			"1",
			"--progress-template",
			`download:${YT_DLP_PROGRESS_PREFIX} %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s`,
			"--no-warnings",
			"-P",
			job.request.outputDir,
			"-o",
			outputTemplate,
			"-f",
			toFormatSelector(job.request.quality, Boolean(this.#paths.ffmpegPath)),
		];

		if (this.#paths.ffmpegPath) {
			args.push("--ffmpeg-location", this.#paths.ffmpegPath);
		}

		args.push(job.request.url);
		return args;
	}
}

function toFormatSelector(quality: string, hasFfmpeg: boolean): string {
	const normalized = quality.toLowerCase().trim();

	if (!hasFfmpeg) {
		if (normalized === "worst") {
			return "worst";
		}

		const heightMatch = normalized.match(/^(\d{3,4})p$/);
		if (heightMatch) {
			const height = Number(heightMatch[1]);
			return `best[height<=${height}]/best`;
		}

		return "best";
	}

	if (normalized === "best") {
		return "bestvideo+bestaudio/best";
	}

	if (normalized === "worst") {
		return "worstvideo+worstaudio/worst";
	}

	const heightMatch = normalized.match(/^(\d{3,4})p$/);
	if (heightMatch) {
		const height = Number(heightMatch[1]);
		return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
	}

	return "bestvideo+bestaudio/best";
}

function buildYtDlpErrorMessage(
	code: number | null,
	stderrSnippet: string,
): string {
	const hint = getMostRelevantErrorLine(stderrSnippet);
	if (!hint) {
		return `yt-dlp failed with exit code ${code ?? "unknown"}`;
	}

	return `yt-dlp failed with exit code ${code ?? "unknown"}: ${hint}`;
}

function getMostRelevantErrorLine(stderrSnippet: string): string | undefined {
	const lines = stderrSnippet
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return undefined;
	}

	const explicitError =
		lines.findLast((line) => line.toLowerCase().includes("error:")) ??
		lines[lines.length - 1];
	return explicitError;
}

function isRetryableStderr(stderrSnippet: string): boolean {
	const text = stderrSnippet.toLowerCase();
	const retryableSignals = [
		"timed out",
		"timeout",
		"connection reset",
		"temporary failure",
		"http error 5",
		"dns",
	];
	return retryableSignals.some((signal) => text.includes(signal));
}

export function createYtDlpStrategySet(paths: YtDlpPaths): {
	strategies: DownloadStrategy[];
	fallback: DownloadStrategy;
} {
	const base = new YtDlpStrategy(paths);

	return {
		strategies: [
			bindStrategyToProviders(base, ["youtube"], "yt-dlp:youtube"),
			bindStrategyToProviders(base, ["tiktok"], "yt-dlp:tiktok"),
			bindStrategyToProviders(base, ["facebook"], "yt-dlp:facebook"),
		],
		fallback: base,
	};
}
