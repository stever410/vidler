import type { DownloadProgress } from "./types.js";

export const YT_DLP_PROGRESS_PREFIX = "[vidler-progress]";

const SIZE_UNITS: Record<string, number> = {
	B: 1,
	KiB: 1024,
	MiB: 1024 ** 2,
	GiB: 1024 ** 3,
	TiB: 1024 ** 4,
	KB: 1000,
	MB: 1000 ** 2,
	GB: 1000 ** 3,
	TB: 1000 ** 4,
};

const SPEED_UNITS: Record<string, number> = {
	B: 1,
	KiB: 1024,
	MiB: 1024 ** 2,
	GiB: 1024 ** 3,
	KB: 1000,
	MB: 1000 ** 2,
	GB: 1000 ** 3,
};

function parseSize(value: string): number | undefined {
	const match = value.match(/([\d.]+)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i);
	if (!match) {
		return undefined;
	}

	const numberPart = match[1];
	const unit = match[2];
	const normalizedUnit = normalizeUnit(unit);
	const multiplier = normalizedUnit ? SIZE_UNITS[normalizedUnit] : undefined;
	if (!numberPart || !unit || multiplier === undefined) {
		return undefined;
	}

	return Number(numberPart) * multiplier;
}

function parseSpeed(value: string): number | undefined {
	const match = value.match(/([\d.]+)\s*(B|KiB|MiB|GiB|KB|MB|GB)\/s/i);
	if (!match) {
		return undefined;
	}

	const numberPart = match[1];
	const unit = match[2];
	const normalizedUnit = normalizeUnit(unit);
	const multiplier = normalizedUnit ? SPEED_UNITS[normalizedUnit] : undefined;
	if (!numberPart || !unit || multiplier === undefined) {
		return undefined;
	}

	return Number(numberPart) * multiplier;
}

function parseEta(value: string): number | undefined {
	const parts = value.split(":").map((part) => Number(part));
	if (parts.some(Number.isNaN)) {
		return undefined;
	}

	if (parts.length === 2) {
		const [mm, ss] = parts;
		if (mm === undefined || ss === undefined) {
			return undefined;
		}
		return mm * 60 + ss;
	}

	if (parts.length === 3) {
		const [hh, mm, ss] = parts;
		if (hh === undefined || mm === undefined || ss === undefined) {
			return undefined;
		}
		return hh * 3600 + mm * 60 + ss;
	}

	return undefined;
}

function normalizeUnit(unit?: string): keyof typeof SIZE_UNITS | undefined {
	if (!unit) {
		return undefined;
	}

	const original = unit.trim();
	const normalized = unit.trim().toUpperCase();
	if (normalized === "B") {
		return "B";
	}

	if (normalized === "KIB" || normalized === "KB") {
		return original.toLowerCase().includes("i") ? "KiB" : "KB";
	}

	if (normalized === "MIB" || normalized === "MB") {
		return original.toLowerCase().includes("i") ? "MiB" : "MB";
	}

	if (normalized === "GIB" || normalized === "GB") {
		return original.toLowerCase().includes("i") ? "GiB" : "GB";
	}

	if (normalized === "TIB" || normalized === "TB") {
		return original.toLowerCase().includes("i") ? "TiB" : "TB";
	}

	return undefined;
}

function parseNullableNumber(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.trim();
	if (
		normalized.length === 0 ||
		normalized.toLowerCase() === "none" ||
		normalized.toLowerCase() === "na"
	) {
		return undefined;
	}

	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePercent(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}

	const match = value.match(/(\d+(?:\.\d+)?)/);
	if (!match?.[1]) {
		return undefined;
	}

	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStructuredYtDlpProgressLine(
	line: string,
): DownloadProgress | undefined {
	const markerIndex = line.indexOf(YT_DLP_PROGRESS_PREFIX);
	if (markerIndex < 0) {
		return undefined;
	}

	const raw = line.slice(markerIndex + YT_DLP_PROGRESS_PREFIX.length).trim();
	const fields = raw.split("|");
	if (fields.length < 7) {
		return undefined;
	}

	const statusRaw = fields[0]?.trim().toLowerCase() ?? "";
	const downloadedBytes = parseNullableNumber(fields[1]);
	const totalBytes =
		parseNullableNumber(fields[2]) ?? parseNullableNumber(fields[3]);
	const speedBps = parseNullableNumber(fields[4]);
	const etaSec = parseNullableNumber(fields[5]);
	let percent = parsePercent(fields[6]);

	if (
		percent === undefined &&
		downloadedBytes !== undefined &&
		totalBytes !== undefined &&
		totalBytes > 0
	) {
		percent = (downloadedBytes / totalBytes) * 100;
	}

	if (statusRaw === "finished") {
		percent = percent ?? 100;
	}

	return {
		status: "running",
		percent,
		totalBytes,
		speedBps,
		etaSec,
		downloadedBytes,
	};
}

export function parseYtDlpProgressLine(
	line: string,
): DownloadProgress | undefined {
	const structured = parseStructuredYtDlpProgressLine(line);
	if (structured) {
		return structured;
	}

	if (!line.includes("[download]")) {
		return undefined;
	}

	const clean = line;
	const percentMatch = clean.match(/(\d+(?:\.\d+)?)%/);
	if (!percentMatch?.[1]) {
		return undefined;
	}

	const totalMatch = clean.match(
		/\bof\s+~?\s*([\d.]+\s*(?:B|KiB|MiB|GiB|TiB|KB|MB|GB|TB))/i,
	);
	const speedMatch = clean.match(
		/\bat\s+([\d.]+\s*(?:B|KiB|MiB|GiB|KB|MB|GB)\/s)\b/i,
	);
	const etaMatch = clean.match(/\bETA\s+((?:\d+:){1,2}\d+)\b/i);

	const percent = Number(percentMatch[1]);
	const totalBytes = totalMatch?.[1] ? parseSize(totalMatch[1]) : undefined;
	const speedBps = speedMatch?.[1] ? parseSpeed(speedMatch[1]) : undefined;
	const etaSec = etaMatch?.[1] ? parseEta(etaMatch[1]) : undefined;

	return {
		status: "running",
		percent: Number.isFinite(percent) ? percent : undefined,
		totalBytes,
		speedBps,
		etaSec,
		downloadedBytes:
			totalBytes !== undefined && Number.isFinite(percent)
				? (totalBytes * percent) / 100
				: undefined,
	};
}
