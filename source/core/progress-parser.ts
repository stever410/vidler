import type { DownloadProgress } from "./types.js";

const SIZE_UNITS: Record<string, number> = {
	B: 1,
	KiB: 1024,
	MiB: 1024 ** 2,
	GiB: 1024 ** 3,
	TiB: 1024 ** 4,
};

const SPEED_UNITS: Record<string, number> = {
	B: 1,
	KiB: 1024,
	MiB: 1024 ** 2,
	GiB: 1024 ** 3,
};

function parseSize(value: string): number | undefined {
	const match = value.match(/([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/);
	if (!match) {
		return undefined;
	}

	const numberPart = match[1];
	const unit = match[2];
	const multiplier = unit ? SIZE_UNITS[unit] : undefined;
	if (!numberPart || !unit || multiplier === undefined) {
		return undefined;
	}

	return Number(numberPart) * multiplier;
}

function parseSpeed(value: string): number | undefined {
	const match = value.match(/([\d.]+)\s*(B|KiB|MiB|GiB)\/s/i);
	if (!match) {
		return undefined;
	}

	const numberPart = match[1];
	const unit = match[2];
	const multiplier = unit ? SPEED_UNITS[unit] : undefined;
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

export function parseYtDlpProgressLine(
	line: string,
): DownloadProgress | undefined {
	const downloadPattern =
		/\[download\]\s+([\d.]+)%\s+of\s+([^\s]+\s(?:B|KiB|MiB|GiB|TiB))\s+at\s+([^\s]+\s(?:B|KiB|MiB|GiB)\/s)\s+ETA\s+([\d:]+)/;
	const match = line.match(downloadPattern);

	if (!match) {
		return undefined;
	}

	const percentPart = match[1];
	const totalPart = match[2];
	const speedPart = match[3];
	const etaPart = match[4];
	if (!percentPart || !totalPart || !speedPart || !etaPart) {
		return undefined;
	}

	const percent = Number(percentPart);
	const totalBytes = parseSize(totalPart);
	const speedBps = parseSpeed(speedPart);
	const etaSec = parseEta(etaPart);

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
