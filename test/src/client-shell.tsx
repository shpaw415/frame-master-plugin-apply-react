import { RouterHost } from "frame-master-plugin-apply-react/router";

export default function ClientShell({
	children,
}: {
	children: React.JSX.Element;
}) {
	return <RouterHost>{children}</RouterHost>;
}
