export default function MainLayout({
	children,
}: {
	children: React.JSX.Element;
}) {
	return (
		<div>
			<h1>Main Layout</h1>
			{children}
			<h1>Main Layout</h1>
		</div>
	);
}
