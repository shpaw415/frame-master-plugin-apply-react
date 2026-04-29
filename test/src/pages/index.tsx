import { useState } from "react";

export default function MainPage() {
	const [state, setState] = useState(0);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			<h1>Main Page {state}</h1>
			<button type="button" onClick={() => setState(state + 1)}>
				Increment
			</button>
			<div>
				<a href="/sub">Go to Sub Page</a>
			</div>
		</div>
	);
}
