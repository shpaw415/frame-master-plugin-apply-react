export function formatPathname(pathname: string) {
	if (pathname === "/") return pathname;
	return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Navigate to a new pathname keeping the SPA behavior (without full page reload).
 */
export function navigate(pathname: string) {
	const a = document.createElement("a");
	a.href = pathname;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}
