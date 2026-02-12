import { InvalidInputError } from "../core/errors.js";
import type { ProviderKind } from "../core/types.js";

export function parseHttpUrl(input: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw new InvalidInputError(`Invalid URL: ${input}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new InvalidInputError(
			`Unsupported URL scheme: ${parsed.protocol}. Use http/https.`,
		);
	}

	return parsed;
}

export function detectProvider(url: URL): ProviderKind {
	const host = url.hostname.toLowerCase();

	if (
		host.includes("youtube.com") ||
		host.includes("youtu.be") ||
		host.includes("music.youtube.com")
	) {
		return "youtube";
	}

	if (host.includes("tiktok.com")) {
		return "tiktok";
	}

	if (host.includes("facebook.com") || host.includes("fb.watch")) {
		return "facebook";
	}

	return "generic";
}
