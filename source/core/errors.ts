export class VidlerError extends Error {
	readonly exitCode: 1 | 2 | 3;
	readonly retryable: boolean;

	constructor(message: string, exitCode: 1 | 2 | 3, retryable = false) {
		super(message);
		this.name = this.constructor.name;
		this.exitCode = exitCode;
		this.retryable = retryable;
	}
}

export class InvalidInputError extends VidlerError {
	constructor(message: string) {
		super(message, 2, false);
	}
}

export class DependencyError extends VidlerError {
	constructor(message: string) {
		super(message, 3, false);
	}
}

export class DownloadError extends VidlerError {
	readonly stderrSnippet?: string;

	constructor(message: string, retryable = false, stderrSnippet?: string) {
		super(message, 1, retryable);
		this.stderrSnippet = stderrSnippet;
	}
}

export function isRetryableError(error: unknown): boolean {
	if (error instanceof VidlerError) {
		return error.retryable;
	}

	if (!(error instanceof Error)) {
		return false;
	}

	const text = error.message.toLowerCase();
	const retryablePatterns = [
		"timeout",
		"timed out",
		"temporary failure",
		"connection reset",
		"econnreset",
		"econnrefused",
		"5xx",
		"dns",
	];

	return retryablePatterns.some((pattern) => text.includes(pattern));
}

export function toExitCode(error: unknown): 1 | 2 | 3 {
	if (error instanceof VidlerError) {
		return error.exitCode;
	}

	return 1;
}
