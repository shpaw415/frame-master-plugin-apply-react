import { useState } from "react";

export default function MainPage() {
	const [state, setState] = useState(0);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			<h1>Main Page {state}</h1>
			<button type="button" onClick={() => setState(state + 1)}>
				Increment
			</button>
			<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
				<a href="/sub">Go to Sub Page</a>
				<a href="/sub/123">Go to Dynamic Sub Page</a>
				<a href="/dynamic/123">Go to Dynamic Sub Page 2</a>
				<a href="/profile">Go to Profile Page (404)</a>
				<a href="/non-existent">Go to Non-existent Page (404)</a>
				<a href="https://google.ca" target="_blank" rel="noopener noreferrer">
					Go to external
				</a>
			</div>
		</div>
	);
}
