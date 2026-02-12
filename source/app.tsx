import { Box, Static, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { DownloadRuntime } from "./core/runtime.js";
import type {
	DownloadProgress,
	DownloadResult,
	JobStatus,
	ProviderKind,
	WorkerEvents,
} from "./core/types.js";

type Props = {
	runtime: DownloadRuntime;
};

type JobView = {
	id: string;
	provider: ProviderKind;
	status: JobStatus;
	attempt: number;
	progress: DownloadProgress;
	result?: DownloadResult;
	error?: string;
};

type EventLog = {
	id: string;
	color: "green" | "yellow" | "red" | "cyan";
	message: string;
};

const EMPTY_PROGRESS: DownloadProgress = {
	status: "queued",
};
const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;

export default function App({ runtime }: Props) {
	const { exit } = useApp();
	const [startedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [tick, setTick] = useState(0);
	const [showDetails, setShowDetails] = useState(true);
	const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
	const [jobState, setJobState] = useState<Record<string, JobView>>(() =>
		Object.fromEntries(
			runtime.jobs.map((job) => [
				job.id,
				createEmptyJobView(job.id, job.detectedProvider),
			]),
		),
	);
	const [fatalError, setFatalError] = useState<string | undefined>();

	useInput((input, key) => {
		if (input === "d") {
			setShowDetails((value) => !value);
			return;
		}

		if (input === "q" || key.escape || (key.ctrl && input === "c")) {
			process.exitCode = 130;
			exit();
		}
	});

	useEffect(() => {
		const timeInterval = setInterval(() => setNow(Date.now()), 1000);
		const spinnerInterval = setInterval(
			() => setTick((value) => value + 1),
			120,
		);

		return () => {
			clearInterval(timeInterval);
			clearInterval(spinnerInterval);
		};
	}, []);

	useEffect(() => {
		const providerByJobId = new Map(
			runtime.jobs.map((job) => [job.id, job.detectedProvider]),
		);
		const resolveProvider = (jobId: string): ProviderKind =>
			providerByJobId.get(jobId) ?? "generic";
		const updateJob = (jobId: string, updater: (state: JobView) => JobView) => {
			setJobState((prev) => {
				const current =
					prev[jobId] ?? createEmptyJobView(jobId, resolveProvider(jobId));
				return {
					...prev,
					[jobId]: updater(current),
				};
			});
		};
		const pushEvent = (color: EventLog["color"], message: string) => {
			setEventLogs((prev) => [
				...prev,
				{ id: `${Date.now()}-${prev.length}`, color, message },
			]);
		};

		const onStarted = (payload: WorkerEvents["jobStarted"]) => {
			updateJob(payload.jobId, (current) => ({
				...current,
				status: "running",
				attempt: payload.attempt,
				progress: {
					...current.progress,
					status: "running",
				},
			}));
		};

		const onProgress = (payload: WorkerEvents["jobProgress"]) => {
			updateJob(payload.jobId, (current) => ({
				...current,
				status: payload.progress.status,
				progress: payload.progress,
			}));
		};

		const onRetry = (payload: WorkerEvents["jobRetry"]) => {
			updateJob(payload.jobId, (current) => ({
				...current,
				status: "retrying",
				attempt: payload.attempt,
				progress: {
					...current.progress,
					status: "retrying",
					message: payload.reason,
				},
			}));
			pushEvent(
				"yellow",
				`retry ${payload.jobId} attempt ${payload.attempt + 1} in ${Math.round(payload.nextDelayMs / 1000)}s`,
			);
		};

		const onCompleted = (payload: WorkerEvents["jobCompleted"]) => {
			updateJob(payload.jobId, (current) => ({
				...current,
				status: "completed",
				attempt: payload.result.attempts,
				result: payload.result,
				progress: { ...EMPTY_PROGRESS, status: "completed", percent: 100 },
			}));
			pushEvent("green", `completed ${payload.jobId}`);
		};

		const onFailed = (payload: WorkerEvents["jobFailed"]) => {
			updateJob(payload.jobId, (current) => ({
				...current,
				status: "failed",
				attempt: payload.result.attempts,
				result: payload.result,
				error: payload.result.errorMessage,
				progress: {
					...current.progress,
					status: "failed",
				},
			}));
			pushEvent(
				"red",
				`failed ${payload.jobId}: ${payload.result.errorMessage ?? "unknown"}`,
			);
		};

		runtime.pool.on("jobStarted", onStarted);
		runtime.pool.on("jobProgress", onProgress);
		runtime.pool.on("jobRetry", onRetry);
		runtime.pool.on("jobCompleted", onCompleted);
		runtime.pool.on("jobFailed", onFailed);

		void runtime
			.start()
			.then((results) => {
				if (results.some((result) => !result.success)) {
					process.exitCode = 1;
				}
			})
			.catch((error: unknown) => {
				process.exitCode = 1;
				setFatalError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				exit();
			});

		return () => {
			runtime.pool.off("jobStarted", onStarted);
			runtime.pool.off("jobProgress", onProgress);
			runtime.pool.off("jobRetry", onRetry);
			runtime.pool.off("jobCompleted", onCompleted);
			runtime.pool.off("jobFailed", onFailed);
		};
	}, [runtime, exit]);

	const summary = useMemo(() => {
		const rows = runtime.jobs.map(
			(job) =>
				jobState[job.id] ?? createEmptyJobView(job.id, job.detectedProvider),
		);
		const aggregateSpeed = rows.reduce(
			(sum, row) => sum + (row.progress.speedBps ?? 0),
			0,
		);
		const averagePercent =
			rows.length === 0
				? 0
				: rows.reduce((sum, row) => sum + (row.progress.percent ?? 0), 0) /
					rows.length;

		return {
			total: rows.length,
			active: rows.filter(
				(row) => row.status === "running" || row.status === "retrying",
			).length,
			completed: rows.filter((row) => row.status === "completed").length,
			failed: rows.filter((row) => row.status === "failed").length,
			aggregateSpeed,
			averagePercent,
		};
	}, [jobState, runtime.jobs]);

	const spinner = SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? "-";
	const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));

	return (
		<Box flexDirection="column" width="100%">
			<Box
				borderStyle="round"
				borderColor="cyan"
				flexDirection="column"
				paddingX={1}
			>
				<Box justifyContent="space-between">
					<Text color="cyan" bold>
						{spinner} Vidler Live
					</Text>
					<Text color="gray">elapsed {formatDuration(elapsedSec)}</Text>
				</Box>
				<Box justifyContent="space-between">
					<Text color="gray">q/esc quit | d toggle details</Text>
					<Text color={summary.failed > 0 ? "red" : "green"}>
						{summary.completed}/{summary.total} completed
					</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<MetricCard
					label="Active"
					value={String(summary.active)}
					color="cyan"
				/>
				<Box marginLeft={1}>
					<MetricCard
						label="Throughput"
						value={formatSpeed(summary.aggregateSpeed)}
						color="blue"
					/>
				</Box>
				<Box marginLeft={1}>
					<MetricCard
						label="Overall"
						value={`${summary.averagePercent.toFixed(1)}%`}
						color="magenta"
					/>
				</Box>
				<Box marginLeft={1}>
					<MetricCard
						label="Failed"
						value={String(summary.failed)}
						color={summary.failed > 0 ? "red" : "green"}
					/>
				</Box>
			</Box>

			<Box
				marginTop={1}
				borderStyle="round"
				borderColor="blue"
				flexDirection="column"
				paddingX={1}
			>
				<Text color="blue" bold>
					Jobs
				</Text>
				{runtime.jobs.map((job) => {
					const view =
						jobState[job.id] ??
						createEmptyJobView(job.id, job.detectedProvider);
					return (
						<JobRow
							key={job.id}
							job={view}
							showDetails={showDetails}
							spinner={spinner}
						/>
					);
				})}
			</Box>

			{eventLogs.length > 0 ? (
				<Box
					marginTop={1}
					borderStyle="round"
					borderColor="magenta"
					flexDirection="column"
					paddingX={1}
				>
					<Text color="magenta" bold>
						Events
					</Text>
					<Static items={eventLogs}>
						{(log) => <Text color={log.color}>- {log.message}</Text>}
					</Static>
				</Box>
			) : null}

			{fatalError ? (
				<Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
					<Text color="red">Fatal: {fatalError}</Text>
				</Box>
			) : null}
		</Box>
	);
}

function MetricCard(props: {
	label: string;
	value: string;
	color: "cyan" | "blue" | "magenta" | "red" | "green";
}) {
	return (
		<Box borderStyle="round" borderColor={props.color} paddingX={1}>
			<Text>
				<Text color="gray">{props.label}: </Text>
				<Text color={props.color} bold>
					{props.value}
				</Text>
			</Text>
		</Box>
	);
}

function JobRow(props: {
	job: JobView;
	showDetails: boolean;
	spinner: string;
}) {
	const statusColor = statusToColor(props.job.status);
	const percent = Math.max(0, Math.min(100, props.job.progress.percent ?? 0));
	const bar = renderBar(percent, 28);
	const statusLabel =
		props.job.status === "running"
			? `${props.spinner} running`
			: props.job.status;

	return (
		<Box
			marginTop={1}
			flexDirection="column"
			borderStyle="single"
			borderColor={statusColor}
			paddingX={1}
		>
			<Box justifyContent="space-between">
				<Text color="gray">
					[{props.job.provider}] {props.job.id}
				</Text>
				<Text color={statusColor} bold>
					{statusLabel}
				</Text>
			</Box>
			<Text color={statusColor}>
				{bar} {percent.toFixed(1)}%
			</Text>
			{props.showDetails ? (
				<Text color="gray">
					attempt {props.job.attempt} | speed{" "}
					{formatSpeed(props.job.progress.speedBps)} | eta{" "}
					{formatEta(props.job.progress.etaSec)} | downloaded{" "}
					{formatBytes(props.job.progress.downloadedBytes)}/
					{formatBytes(props.job.progress.totalBytes)}
				</Text>
			) : null}
			{props.job.error ? <Text color="red">{props.job.error}</Text> : null}
		</Box>
	);
}

function createEmptyJobView(id: string, provider: ProviderKind): JobView {
	return {
		id,
		provider,
		status: "queued",
		attempt: 0,
		progress: EMPTY_PROGRESS,
	};
}

function statusToColor(
	status: JobStatus,
): "gray" | "blue" | "cyan" | "yellow" | "green" | "red" {
	switch (status) {
		case "queued":
			return "gray";
		case "preparing":
			return "blue";
		case "running":
			return "cyan";
		case "retrying":
			return "yellow";
		case "completed":
			return "green";
		case "failed":
			return "red";
	}
}

function renderBar(percent: number, width: number): string {
	const filled = Math.round((percent / 100) * width);
	return `[${"=".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}]`;
}

function formatBytes(bytes?: number): string {
	if (!bytes || bytes <= 0) {
		return "0 B";
	}

	const units = ["B", "KB", "MB", "GB", "TB"] as const;
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(speedBps?: number): string {
	if (!speedBps || speedBps <= 0) {
		return "n/a";
	}
	return `${formatBytes(speedBps)}/s`;
}

function formatEta(etaSec?: number): string {
	if (!etaSec || etaSec <= 0) {
		return "n/a";
	}
	return formatDuration(Math.floor(etaSec));
}

function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, totalSeconds);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainderSeconds = seconds % 60;

	if (hours > 0) {
		return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainderSeconds).padStart(2, "0")}`;
	}

	return `${String(minutes).padStart(2, "0")}:${String(remainderSeconds).padStart(2, "0")}`;
}
