import { ThrowNotFound } from "../../../../src/utils";

export default function Profile() {
	ThrowNotFound();

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			<h1>Profile Page</h1>
			<a href="/">Go back to Main Page</a>
		</div>
	);
}
