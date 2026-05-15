import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({
	children,
}: {
	children: React.JSX.Element;
}) {
	return (
		<RouterHost
			onRouteChange={(match) => {
				if (match.pathname === "/sub") {
					return new Promise((resolve) => {
						console.log("Route changed to:", match);
						setTimeout(resolve, 2000);
					});
				}
			}}
		>
			{children}
		</RouterHost>
	);
}
