import { EventEmitter } from "node:events";
import { isRetryableError } from "./errors.js";
import type { DownloadJob, DownloadResult, WorkerEvents } from "./types.js";

export type JobRunner = (
	job: DownloadJob,
	attempt: number,
) => Promise<DownloadResult>;

export type WorkerPoolOptions = {
	concurrency: number;
	retries: number;
	baseBackoffMs?: number;
};

export class WorkerPool extends EventEmitter {
	readonly #options: WorkerPoolOptions;

	constructor(options: WorkerPoolOptions) {
		super();
		this.#options = {
			...options,
			baseBackoffMs: options.baseBackoffMs ?? 500,
		};
	}

	override on<K extends keyof WorkerEvents>(
		event: K,
		listener: (payload: WorkerEvents[K]) => void,
	): this {
		return super.on(event, listener);
	}

	override off<K extends keyof WorkerEvents>(
		event: K,
		listener: (payload: WorkerEvents[K]) => void,
	): this {
		return super.off(event, listener);
	}

	override emit<K extends keyof WorkerEvents>(
		event: K,
		payload: WorkerEvents[K],
	): boolean {
		return super.emit(event, payload);
	}

	async run(jobs: DownloadJob[], runJob: JobRunner): Promise<DownloadResult[]> {
		const queue = [...jobs];
		const results: DownloadResult[] = [];
		const workerCount = Math.max(
			1,
			Math.min(this.#options.concurrency, queue.length || 1),
		);

		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (queue.length > 0) {
					const job = queue.shift();
					if (!job) {
						continue;
					}

					results.push(await this.#runWithRetry(job, runJob));
				}
			}),
		);

		return results;
	}

	async #runWithRetry(
		job: DownloadJob,
		runJob: JobRunner,
	): Promise<DownloadResult> {
		const startedAt = Date.now();
		const maxAttempts = Math.max(1, this.#options.retries + 1);

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			this.emit("jobStarted", {
				jobId: job.id,
				provider: job.detectedProvider,
				attempt,
			});

			try {
				const result = await runJob(job, attempt);
				this.emit("jobCompleted", { jobId: job.id, result });
				return result;
			} catch (error) {
				const retryable = isRetryableError(error);
				const isLastAttempt = attempt >= maxAttempts;
				const reason =
					error instanceof Error ? error.message : "Unknown download failure";

				if (retryable && !isLastAttempt) {
					const nextDelayMs = this.#computeBackoff(attempt);
					this.emit("jobRetry", {
						jobId: job.id,
						attempt,
						reason,
						nextDelayMs,
					});
					await delay(nextDelayMs);
					continue;
				}

				const result: DownloadResult = {
					jobId: job.id,
					success: false,
					provider: job.detectedProvider,
					durationMs: Date.now() - startedAt,
					attempts: attempt,
					errorMessage: reason,
				};

				this.emit("jobFailed", { jobId: job.id, result });
				return result;
			}
		}

		return {
			jobId: job.id,
			success: false,
			provider: job.detectedProvider,
			durationMs: Date.now() - startedAt,
			attempts: maxAttempts,
			errorMessage: "Unexpected worker pool state",
		};
	}

	#computeBackoff(attempt: number): number {
		const base = this.#options.baseBackoffMs ?? 500;
		const factor = 2 ** Math.max(0, attempt - 1);
		const jitter = 0.8 + Math.random() * 0.4;
		return Math.round(base * factor * jitter);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
