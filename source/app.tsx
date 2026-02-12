import { Alert, Badge, ProgressBar, Spinner, StatusMessage } from "@inkjs/ui";
import chalk from "chalk";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
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
	showLogs?: boolean;
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

type DownloadLog = {
	id: string;
	jobId: string;
	stream: "stdout" | "stderr" | "system";
	message: string;
};

const EMPTY_PROGRESS: DownloadProgress = {
	status: "queued",
};

const SOFT = chalk.hex("#AAB7CF");
const ICONS = {
	title: "◈",
	time: "⏱",
	speed: "⇣",
	progress: "◌",
	size: "⬇",
	retry: "↻",
	logs: "📜",
} as const;

export default function App({ runtime, showLogs = false }: Props) {
	const { exit } = useApp();
	const primaryJob = runtime.jobs[0];
	const primaryJobId = primaryJob?.id ?? "job-missing";
	const primaryProvider = primaryJob?.detectedProvider ?? "generic";

	const [startedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [showDetails, setShowDetails] = useState(true);
	const [logsExpanded, setLogsExpanded] = useState(false);
	const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
	const [jobView, setJobView] = useState<JobView>(() =>
		createEmptyJobView(primaryJobId, primaryProvider),
	);
	const [fatalError, setFatalError] = useState<string | undefined>();
	const [notice, setNotice] = useState<string | undefined>();

	useInput((input, key) => {
		if (input === "d") {
			setShowDetails((value) => !value);
			return;
		}
		if (input === "l" && showLogs) {
			setLogsExpanded((value) => !value);
			return;
		}
		if (input === "q" || key.escape || (key.ctrl && input === "c")) {
			process.exitCode = 130;
			exit();
		}
	});

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		if (!primaryJob) {
			return;
		}

		const updateJob = (updater: (state: JobView) => JobView) => {
			setJobView((current) => updater(current));
		};
		const pushDownloadLog = (
			stream: DownloadLog["stream"],
			message: string,
		) => {
			setDownloadLogs((prev) => {
				const next = [
					...prev,
					{
						id: `${Date.now()}-${prev.length}`,
						jobId: primaryJobId,
						stream,
						message,
					},
				];
				return next.slice(-160);
			});
		};
		const isPrimaryJob = (jobId: string): boolean => jobId === primaryJobId;

		const onStarted = (payload: WorkerEvents["jobStarted"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			updateJob((current) => ({
				...current,
				status: "running",
				attempt: payload.attempt,
				progress: {
					...current.progress,
					status: "running",
				},
			}));
			setNotice(undefined);
		};

		const onProgress = (payload: WorkerEvents["jobProgress"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			updateJob((current) => ({
				...current,
				status: payload.progress.status,
				progress: {
					...current.progress,
					...payload.progress,
				},
			}));
		};

		const onRetry = (payload: WorkerEvents["jobRetry"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			updateJob((current) => ({
				...current,
				status: "retrying",
				attempt: payload.attempt,
				progress: {
					...current.progress,
					status: "retrying",
					message: payload.reason,
				},
			}));
			setNotice(
				`Retrying in ${Math.round(payload.nextDelayMs / 1000)}s: ${payload.reason}`,
			);
		};

		const onCompleted = (payload: WorkerEvents["jobCompleted"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			updateJob((current) => ({
				...current,
				status: "completed",
				attempt: payload.result.attempts,
				result: payload.result,
				progress: { ...EMPTY_PROGRESS, status: "completed", percent: 100 },
			}));
			setNotice("Download completed successfully.");
		};

		const onFailed = (payload: WorkerEvents["jobFailed"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			updateJob((current) => ({
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
			setNotice("Download failed. Review the logs for details.");
		};

		const onLog = (payload: WorkerEvents["jobLog"]) => {
			if (!isPrimaryJob(payload.jobId)) {
				return;
			}
			pushDownloadLog(payload.stream, payload.message);
		};

		runtime.pool.on("jobStarted", onStarted);
		runtime.pool.on("jobProgress", onProgress);
		runtime.pool.on("jobRetry", onRetry);
		runtime.pool.on("jobCompleted", onCompleted);
		runtime.pool.on("jobFailed", onFailed);
		if (showLogs) {
			runtime.pool.on("jobLog", onLog);
		}

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
			if (showLogs) {
				runtime.pool.off("jobLog", onLog);
			}
		};
	}, [runtime, exit, primaryJob, primaryJobId, showLogs]);

	const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
	const progressPercent = Math.max(
		0,
		Math.min(
			100,
			jobView.progress.percent ?? (jobView.status === "completed" ? 100 : 0),
		),
	);
	const statusColor = statusToColor(jobView.status);
	const displayLogs = logsExpanded ? downloadLogs : downloadLogs.slice(-5);

	if (!primaryJob) {
		return (
			<Alert variant="error" title="No Job">
				No download job was scheduled.
			</Alert>
		);
	}

	return (
		<Box flexDirection="column" width="100%" gap={1}>
			<Box
				borderStyle="round"
				borderColor="cyan"
				flexDirection="column"
				paddingX={1}
			>
				<Box justifyContent="space-between">
					<Spinner label={`${ICONS.title} Vidler Live`} type="dots" />
					<Text>
						{SOFT(`${ICONS.time} elapsed ${formatDuration(elapsedSec)}`)}
					</Text>
				</Box>
				<Box justifyContent="space-between">
					<Text color="gray">
						q/esc exit | d details
						{showLogs ? " | l logs expand/collapse" : ""}
					</Text>
					<Badge color={statusColor}>
						{statusIcon(jobView.status)} {jobView.status}
					</Badge>
				</Box>
			</Box>

			<Box
				borderStyle="round"
				borderColor={statusColor}
				flexDirection="column"
				paddingX={1}
			>
				<Box justifyContent="space-between">
					<Text color="gray">
						[{providerLabel(jobView.provider)}] {SOFT(jobView.id)}
					</Text>
					<Text>{progressPercent.toFixed(1)}%</Text>
				</Box>
				<Box alignItems="center" gap={1}>
					<Box width={64}>
						<ProgressBar value={progressPercent} />
					</Box>
				</Box>
				<Box>
					<MetricPill
						label={`${ICONS.speed} Speed`}
						value={formatSpeed(jobView.progress.speedBps)}
						color="blue"
					/>
					<Box marginLeft={1}>
						<MetricPill
							label={`${ICONS.progress} ETA`}
							value={formatEta(jobView.progress.etaSec)}
							color="magenta"
						/>
					</Box>
					<Box marginLeft={1}>
						<MetricPill
							label={`${ICONS.size} Size`}
							value={`${formatBytes(jobView.progress.downloadedBytes)} / ${formatBytes(jobView.progress.totalBytes)}`}
							color="cyan"
						/>
					</Box>
					<Box marginLeft={1}>
						<MetricPill
							label={`${ICONS.retry} Attempt`}
							value={String(jobView.attempt)}
							color={jobView.status === "retrying" ? "yellow" : "green"}
						/>
					</Box>
				</Box>
				{showDetails ? (
					<Text color="gray">
						output: {jobView.result?.filePath ?? "pending"} | error:{" "}
						{jobView.error ?? "none"}
					</Text>
				) : null}
			</Box>

			{notice ? <StatusMessage variant="info">{notice}</StatusMessage> : null}

			{showLogs ? (
				<Box
					borderStyle="round"
					borderColor="yellow"
					flexDirection="column"
					paddingX={1}
				>
					<Box justifyContent="space-between">
						<Text color="yellow" bold>
							{ICONS.logs} Download Logs
						</Text>
						<Badge color="yellow">
							{logsExpanded ? "expanded" : "collapsed"} ({downloadLogs.length})
						</Badge>
					</Box>
					{displayLogs.length === 0 ? (
						<Text color="gray">No log lines yet.</Text>
					) : (
						<Box flexDirection="column">
							{displayLogs.map((log) => (
								<Text key={log.id} color={downloadLogColor(log.stream)}>
									[{log.stream}]{">"} {log.message}
								</Text>
							))}
						</Box>
					)}
				</Box>
			) : null}

			{fatalError ? (
				<Alert variant="error" title="Error">
					{fatalError}
				</Alert>
			) : null}
		</Box>
	);
}

function MetricPill(props: {
	label: string;
	value: string;
	color: "cyan" | "blue" | "magenta" | "yellow" | "green";
}) {
	return (
		<Box borderStyle="round" borderColor={props.color} paddingX={1}>
			<Badge color={props.color}>{props.label}</Badge>
			<Text> {props.value}</Text>
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

function providerLabel(provider: ProviderKind): string {
	switch (provider) {
		case "youtube":
			return chalk.hex("#FF6B7D")("▶ YT");
		case "tiktok":
			return chalk.hex("#FFCC66")("♪ TT");
		case "facebook":
			return chalk.hex("#7DF9FF")("f FB");
		case "generic":
			return chalk.hex("#AAB7CF")("◎ WEB");
	}
}

function statusIcon(status: JobStatus): string {
	switch (status) {
		case "queued":
			return "○";
		case "preparing":
			return "◔";
		case "running":
			return "▶";
		case "retrying":
			return "↻";
		case "completed":
			return "✓";
		case "failed":
			return "✕";
	}
}

function downloadLogColor(
	stream: DownloadLog["stream"],
): "gray" | "red" | "cyan" {
	switch (stream) {
		case "stderr":
			return "red";
		case "system":
			return "cyan";
		case "stdout":
			return "gray";
	}
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
