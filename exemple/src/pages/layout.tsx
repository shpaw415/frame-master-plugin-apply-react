import { useState } from "react";

export default function MainLayout({
	children,
}: {
	children: React.JSX.Element;
}) {
	const [counter, setCounter] = useState(0);
	return (
		<div>
			<h1>Main Layout {counter}</h1>
			{children}
			<button type="button" onClick={() => setCounter((c) => c + 1)}>
				Increment
			</button>
		</div>
	);
}
