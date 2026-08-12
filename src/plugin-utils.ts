export function escapeRegExp(string: string) {
	return new RegExp(string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
