import type { DownloadStrategy } from "./strategy.js";
import { StrategyRegistry } from "./strategy.js";
import type { DownloadJob, DownloadResult } from "./types.js";
import { WorkerPool } from "./worker-pool.js";

type RuntimeConfig = {
	jobs: DownloadJob[];
	strategies: DownloadStrategy[];
	fallback: DownloadStrategy;
	concurrency: number;
	retries: number;
};

export type DownloadRuntime = {
	pool: WorkerPool;
	jobs: DownloadJob[];
	start: () => Promise<DownloadResult[]>;
};

export function createRuntime(config: RuntimeConfig): DownloadRuntime {
	const pool = new WorkerPool({
		concurrency: config.concurrency,
		retries: config.retries,
	});
	const registry = new StrategyRegistry(config.strategies, config.fallback);
	const runner = new RuntimeJobRunner(pool, registry);
	let runPromise: Promise<DownloadResult[]> | undefined;

	return {
		pool,
		jobs: config.jobs,
		start: async () => {
			if (!runPromise) {
				runPromise = pool.run(config.jobs, (job, attempt) =>
					runner.runJob(job, attempt),
				);
			}

			return runPromise;
		},
	};
}

class RuntimeJobRunner {
	readonly #pool: WorkerPool;
	readonly #registry: StrategyRegistry;

	constructor(pool: WorkerPool, registry: StrategyRegistry) {
		this.#pool = pool;
		this.#registry = registry;
	}

	async runJob(job: DownloadJob, attempt: number): Promise<DownloadResult> {
		this.#emitPreparing(job.id);
		const strategy = this.#registry.resolve(job);
		const prepared = await strategy.prepare(job);
		const result = await strategy.download(prepared, (progress) => {
			this.#pool.emit("jobProgress", { jobId: job.id, progress });
		});

		return {
			...result,
			attempts: attempt,
		};
	}

	#emitPreparing(jobId: string): void {
		this.#pool.emit("jobProgress", {
			jobId,
			progress: { status: "preparing" },
		});
	}
}
