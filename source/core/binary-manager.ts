import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, stat } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
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
		const ffmpegPath = await this.#ensureFfmpeg(verbose);

		if (!ffmpegPath && verbose) {
			console.error(
				"warning: ffmpeg is unavailable. Some merges/formats may fail.",
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

	async #ensureFfmpeg(verbose: boolean): Promise<string | undefined> {
		const existing = await this.#findBinary("ffmpeg");
		if (existing) {
			return existing;
		}

		const cachedPath = path.join(
			this.#cacheDir,
			this.#executableName("ffmpeg"),
		);
		if (await this.#isExecutable(cachedPath)) {
			return cachedPath;
		}

		let downloadUrl: string | undefined;
		try {
			downloadUrl = await this.#resolveFfmpegDownloadUrl();
		} catch (error) {
			if (verbose) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					`warning: failed to resolve ffmpeg bootstrap URL: ${message}`,
				);
			}
			return undefined;
		}
		if (!downloadUrl) {
			return undefined;
		}

		if (verbose) {
			console.error(`bootstrapping ffmpeg from ${downloadUrl}`);
		}

		try {
			await downloadToFile(downloadUrl, cachedPath);
			if (platform() !== "win32") {
				await chmod(cachedPath, 0o755);
			}

			if (!(await this.#isExecutable(cachedPath))) {
				throw new DependencyError("Failed to bootstrap ffmpeg binary.");
			}

			return cachedPath;
		} catch (error) {
			if (verbose) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`warning: failed to bootstrap ffmpeg: ${message}`);
			}
			return undefined;
		}
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

	async #resolveFfmpegDownloadUrl(): Promise<string | undefined> {
		const candidates = this.#ffmpegAssetCandidates();
		if (candidates.length === 0) {
			return undefined;
		}

		const response = await fetch(
			"https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest",
			{
				headers: {
					accept: "application/vnd.github+json",
					"user-agent": "vidler/1.0",
				},
			},
		);
		if (!response.ok) {
			throw new DependencyError(
				`Failed to resolve ffmpeg release metadata (${response.status}).`,
			);
		}

		const payload = (await response.json()) as {
			assets?: Array<{ name?: string; browser_download_url?: string }>;
		};
		const assets = payload.assets ?? [];

		for (const name of candidates) {
			const exact = assets.find(
				(asset) => asset.name === name && asset.browser_download_url,
			);
			if (exact?.browser_download_url) {
				return exact.browser_download_url;
			}
		}

		for (const name of candidates) {
			const prefix = name.endsWith(".exe") ? name.slice(0, -4) : name;
			const relaxed = assets.find((asset) => {
				const assetName = asset.name ?? "";
				return (
					Boolean(asset.browser_download_url) &&
					assetName.startsWith(prefix) &&
					!assetName.endsWith(".gz") &&
					!assetName.includes(".README") &&
					!assetName.includes(".LICENSE")
				);
			});
			if (relaxed?.browser_download_url) {
				return relaxed.browser_download_url;
			}
		}

		return undefined;
	}

	#ffmpegAssetCandidates(): string[] {
		const os = platform();
		const cpu = arch();

		if (os === "linux") {
			if (cpu === "x64") {
				return ["ffmpeg-linux-x64"];
			}
			if (cpu === "arm64") {
				return ["ffmpeg-linux-arm64"];
			}
			if (cpu === "arm") {
				return ["ffmpeg-linux-armhf", "ffmpeg-linux-arm"];
			}
			if (cpu === "ia32") {
				return ["ffmpeg-linux-ia32", "ffmpeg-linux-x86"];
			}
			return [];
		}

		if (os === "darwin") {
			if (cpu === "arm64") {
				return ["ffmpeg-darwin-arm64"];
			}
			if (cpu === "x64") {
				return ["ffmpeg-darwin-x64"];
			}
			return [];
		}

		if (os === "win32") {
			if (cpu === "x64") {
				return ["ffmpeg-win32-x64.exe", "ffmpeg-win32-x64"];
			}
			if (cpu === "ia32") {
				return ["ffmpeg-win32-ia32.exe", "ffmpeg-win32-ia32"];
			}
			if (cpu === "arm64") {
				return ["ffmpeg-win32-arm64.exe", "ffmpeg-win32-arm64"];
			}
			return [];
		}

		return [];
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
