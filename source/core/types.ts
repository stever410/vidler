export type ProviderKind = "youtube" | "tiktok" | "facebook" | "generic";

export type JobStatus =
	| "queued"
	| "preparing"
	| "running"
	| "retrying"
	| "completed"
	| "failed";

export type DownloadRequest = {
	url: string;
	quality: string;
	outputDir: string;
	filenameTemplate?: string;
	retries: number;
	timeoutSec?: number;
};

export type DownloadJob = {
	id: string;
	request: DownloadRequest;
	detectedProvider: ProviderKind;
};

export type DownloadProgress = {
	status: JobStatus;
	percent?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	speedBps?: number;
	etaSec?: number;
	message?: string;
};

export type DownloadResult = {
	jobId: string;
	success: boolean;
	provider: ProviderKind;
	filePath?: string;
	durationMs: number;
	attempts: number;
	errorMessage?: string;
};

export type PreparedJob = {
	job: DownloadJob;
	provider: ProviderKind;
	command: string;
	args: string[];
};

export type WorkerEvents = {
	jobStarted: { jobId: string; provider: ProviderKind; attempt: number };
	jobProgress: { jobId: string; progress: DownloadProgress };
	jobRetry: {
		jobId: string;
		attempt: number;
		reason: string;
		nextDelayMs: number;
	};
	jobCompleted: { jobId: string; result: DownloadResult };
	jobFailed: { jobId: string; result: DownloadResult };
};
