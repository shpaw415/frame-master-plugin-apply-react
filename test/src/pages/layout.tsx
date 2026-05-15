import { useState } from "react";

export default function MainLayout({
	children,
}: {
	children: React.JSX.Element;
}) {
	const [layoutState, setLayoutState] = useState("initial layout state");

	return (
		<div>
			<h1>Main Layout</h1>
			<label>
				Layout State
				<input
					aria-label="layout-state"
					value={layoutState}
					onChange={(event) => setLayoutState(event.target.value)}
				/>
			</label>
			<nav
				aria-label="main navigation"
				style={{ display: "flex", gap: "1rem" }}
			>
				<a href="/">Home</a>
				<a href="/sub?id=1">Sub</a>
				<a href="/profile">Profile</a>
			</nav>
			{children}
			<h1>Main Layout</h1>
		</div>
	);
}
