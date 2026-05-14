import { useState } from "react";

export default function MainPage() {
	const [state, setState] = useState(0);
	return (
		<div>
			<h1>Main Page {state}</h1>
			<button type="button" onClick={() => setState(state + 1)}>
				Increment
			</button>
			<a href="/about">Go to about page</a>
		</div>
	);
}
