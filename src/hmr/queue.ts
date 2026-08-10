export type DevBuildTarget = {
	matchedRoute: Bun.MatchedRoute;
	pathname: string;
};

/**
 * FIFO queue of selective route builds, deduped by route name.
 */
export class DevBuildQueue {
	private readonly queue: DevBuildTarget[] = [];
	private readonly names = new Set<string>();

	enqueue(target: DevBuildTarget): boolean {
		const name = target.matchedRoute.name;
		if (this.names.has(name)) return false;
		this.names.add(name);
		this.queue.push(target);
		return true;
	}

	shift(): DevBuildTarget | undefined {
		const next = this.queue.shift();
		if (next) this.names.delete(next.matchedRoute.name);
		return next;
	}

	clear() {
		this.queue.length = 0;
		this.names.clear();
	}

	get size() {
		return this.queue.length;
	}

	get isEmpty() {
		return this.queue.length === 0;
	}
}
