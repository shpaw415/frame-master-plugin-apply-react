import { useState } from "react";

export default function MainPage() {
	const [state, setState] = useState(0);
	return (
		<div>
			<h1>Main Page {state}</h1>
			<button type="button" onClick={() => setState(state + 1)}>
				Increment
			</button>
			<div
				style={{
					marginTop: "1rem",
					display: "flex",
					flexDirection: "column",
					gap: "0.5rem",
				}}
			>
				<a href="/about">Go to about page</a>
				<a href="/sub/123">Go to sub page with id 123</a>
				<a href="/non-existent">Go to non-existent page</a>
				<a href="/sub">raw sub page</a>
			</div>
		</div>
	);
}
