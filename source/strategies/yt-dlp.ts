import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DownloadError } from "../core/errors.js";
import { parseYtDlpProgressLine } from "../core/progress-parser.js";
import {
	bindStrategyToProviders,
	type DownloadStrategy,
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
						`yt-dlp failed with exit code ${code ?? "unknown"}`,
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
			"--no-warnings",
			"-P",
			job.request.outputDir,
			"-o",
			outputTemplate,
			"-f",
			toFormatSelector(job.request.quality),
		];

		if (this.#paths.ffmpegPath) {
			args.push("--ffmpeg-location", this.#paths.ffmpegPath);
		}

		args.push(job.request.url);
		return args;
	}
}

function toFormatSelector(quality: string): string {
	const normalized = quality.toLowerCase().trim();

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
