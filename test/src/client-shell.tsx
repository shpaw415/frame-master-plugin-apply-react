import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({
	children,
}: {
	children: React.JSX.Element;
}) {
	return (
		<RouterHost
			onRouteChange={(match) => {
				console.log({ match });
			}}
		>
			{children}
		</RouterHost>
	);
}
