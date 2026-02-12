import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export async function ensureOutputDir(outputDir: string): Promise<string> {
	const resolved = path.resolve(outputDir);
	await mkdir(resolved, { recursive: true });
	const info = await stat(resolved);
	if (!info.isDirectory()) {
		throw new Error(`Output path is not a directory: ${resolved}`);
	}
	return resolved;
}

export function sanitizeFilenameSegment(input: string): string {
	return input
		.trim()
		.replace(/[<>:"/\\|?*]/g, "_")
		.split("")
		.map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
		.join("")
		.replace(/\s+/g, " ")
		.slice(0, 180);
}
