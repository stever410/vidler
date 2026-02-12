import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DependencyError } from "./errors.js";

export type BinaryPaths = {
	ytDlpPath: string;
	ffmpegPath?: string;
};

export class BinaryManager {
	readonly #cacheDir: string;

	constructor(cacheDir?: string) {
		this.#cacheDir =
			cacheDir ?? path.join(homedir(), ".cache", "vidler", "bin");
	}

	async ensureBinaries(verbose = false): Promise<BinaryPaths> {
		await mkdir(this.#cacheDir, { recursive: true });

		const ytDlpPath = await this.#ensureYtDlp(verbose);
		const ffmpegPath = await this.#findBinary("ffmpeg");

		if (!ffmpegPath && verbose) {
			console.error(
				"warning: ffmpeg not found in PATH. Some merges/formats may fail.",
			);
		}

		return { ytDlpPath, ffmpegPath: ffmpegPath ?? undefined };
	}

	async #ensureYtDlp(verbose: boolean): Promise<string> {
		const existing = await this.#findBinary("yt-dlp");
		if (existing) {
			return existing;
		}

		const cachedPath = path.join(
			this.#cacheDir,
			this.#executableName("yt-dlp"),
		);
		if (await this.#isExecutable(cachedPath)) {
			return cachedPath;
		}

		const downloadUrl = this.#ytDlpUrl();
		if (!downloadUrl) {
			throw new DependencyError(
				"yt-dlp is missing and automatic bootstrap is not supported on this platform.",
			);
		}

		if (verbose) {
			console.error(`bootstrapping yt-dlp from ${downloadUrl}`);
		}

		await downloadToFile(downloadUrl, cachedPath);
		await chmod(cachedPath, 0o755);

		if (!(await this.#isExecutable(cachedPath))) {
			throw new DependencyError("Failed to bootstrap yt-dlp binary.");
		}

		return cachedPath;
	}

	#ytDlpUrl(): string | undefined {
		if (platform() === "linux") {
			return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
		}

		if (platform() === "darwin") {
			return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
		}

		if (platform() === "win32") {
			return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
		}

		return undefined;
	}

	#executableName(base: string): string {
		return platform() === "win32" ? `${base}.exe` : base;
	}

	async #isExecutable(filePath: string): Promise<boolean> {
		try {
			await access(filePath);
			const info = await stat(filePath);
			return info.isFile();
		} catch {
			return false;
		}
	}

	async #findBinary(name: string): Promise<string | undefined> {
		const { PATH: pathValue } = process.env;
		if (!pathValue) {
			return undefined;
		}

		const extList =
			platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
		for (const dir of pathValue.split(path.delimiter)) {
			for (const ext of extList) {
				const fullPath = path.join(dir, `${name}${ext}`);
				if (await this.#isExecutable(fullPath)) {
					return fullPath;
				}
			}
		}

		return undefined;
	}
}

async function downloadToFile(url: string, destination: string): Promise<void> {
	const response = await fetch(url, {
		headers: {
			"user-agent": "vidler/1.0",
		},
	});

	if (!response.ok || !response.body) {
		throw new DependencyError(
			`Failed to download dependency from ${url} (${response.status}).`,
		);
	}

	const body = Readable.fromWeb(response.body as never);
	await pipeline(body, createWriteStream(destination));
}
