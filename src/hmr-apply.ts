export type HotApplyAction = "refresh" | "remount" | "reload" | "skip";

export type HotApplyInput = {
	fastRefreshEnabled: boolean;
	isActiveRoute: boolean;
	previousType: unknown;
	nextType: unknown;
	sourceHash?: string;
	lastAppliedHash?: string;
};

export function hashHmrSource(source: string): string {
	return Bun.hash(source).toString(16);
}

export function decideHotApply({
	fastRefreshEnabled,
	isActiveRoute,
	previousType,
	nextType,
	sourceHash,
	lastAppliedHash,
}: HotApplyInput): HotApplyAction {
	if (!isActiveRoute) return "skip";
	if (!fastRefreshEnabled) return "remount";

	const hashUnchanged =
		Boolean(sourceHash) &&
		Boolean(lastAppliedHash) &&
		sourceHash === lastAppliedHash;
	if (hashUnchanged) return "skip";

	const identityUnchanged =
		previousType !== null &&
		previousType !== undefined &&
		previousType === nextType;

	if (identityUnchanged && sourceHash && sourceHash !== lastAppliedHash) {
		return "reload";
	}

	return "refresh";
}
