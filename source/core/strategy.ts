import type {
	DownloadJob,
	DownloadProgress,
	DownloadResult,
	PreparedJob,
	ProviderKind,
} from "./types.js";

export type ProgressEmitter = (progress: DownloadProgress) => void;

export type DownloadStrategy = {
	readonly name: string;
	canHandle(job: DownloadJob): boolean;
	prepare(job: DownloadJob): Promise<PreparedJob>;
	download(
		prepared: PreparedJob,
		emit: ProgressEmitter,
	): Promise<DownloadResult>;
};

export class StrategyRegistry {
	readonly #strategies: DownloadStrategy[];
	readonly #fallback: DownloadStrategy;

	constructor(strategies: DownloadStrategy[], fallback: DownloadStrategy) {
		this.#strategies = strategies;
		this.#fallback = fallback;
	}

	resolve(job: DownloadJob): DownloadStrategy {
		for (const strategy of this.#strategies) {
			if (strategy.canHandle(job)) {
				return strategy;
			}
		}

		return this.#fallback;
	}
}

export function bindStrategyToProviders(
	base: DownloadStrategy,
	providers: ProviderKind[],
	name = `${base.name}:${providers.join(",")}`,
): DownloadStrategy {
	const providerSet = new Set(providers);

	return {
		name,
		canHandle(job) {
			return providerSet.has(job.detectedProvider);
		},
		prepare(job) {
			return base.prepare(job);
		},
		download(prepared, emit) {
			return base.download(prepared, emit);
		},
	};
}
