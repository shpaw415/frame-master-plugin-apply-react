import {
	transformAsync,
	type NodePath,
	type PluginAPI,
	type PluginObject,
} from "@babel/core";
import * as types from "@babel/types";
import reactRefreshBabel from "react-refresh/babel";

type ReactImportBindings = {
	createContext: Set<string>;
	namespace: Set<string>;
};

export type ReactRefreshTransformOptions = {
	filename: string;
	moduleId: string;
};

function getReactImportBindings(program: types.Program): ReactImportBindings {
	const bindings: ReactImportBindings = {
		createContext: new Set<string>(),
		namespace: new Set<string>(),
	};

	for (const statement of program.body) {
		if (
			!types.isImportDeclaration(statement) ||
			statement.source.value !== "react"
		) {
			continue;
		}

		for (const specifier of statement.specifiers) {
			if (
				types.isImportSpecifier(specifier) &&
				types.isIdentifier(specifier.imported, { name: "createContext" })
			) {
				bindings.createContext.add(specifier.local.name);
			}
			if (
				types.isImportNamespaceSpecifier(specifier) ||
				types.isImportDefaultSpecifier(specifier)
			) {
				bindings.namespace.add(specifier.local.name);
			}
		}
	}

	return bindings;
}

function isCreateContextCall(
	node: types.Expression,
	bindings: ReactImportBindings,
) {
	if (!types.isCallExpression(node)) return false;

	if (types.isIdentifier(node.callee)) {
		return bindings.createContext.has(node.callee.name);
	}

	return (
		types.isMemberExpression(node.callee) &&
		!node.callee.computed &&
		types.isIdentifier(node.callee.object) &&
		bindings.namespace.has(node.callee.object.name) &&
		types.isIdentifier(node.callee.property, { name: "createContext" })
	);
}

function getExportedNames(program: types.Program) {
	const exportedNames = new Map<string, string>();

	for (const statement of program.body) {
		if (!types.isExportNamedDeclaration(statement)) continue;

		if (types.isVariableDeclaration(statement.declaration)) {
			for (const declarator of statement.declaration.declarations) {
				if (types.isIdentifier(declarator.id)) {
					exportedNames.set(declarator.id.name, declarator.id.name);
				}
			}
		}

		for (const specifier of statement.specifiers) {
			if (
				types.isExportSpecifier(specifier) &&
				types.isIdentifier(specifier.local) &&
				types.isIdentifier(specifier.exported)
			) {
				exportedNames.set(specifier.local.name, specifier.exported.name);
			}
		}
	}

	return exportedNames;
}

function stabilizeExportedContexts(
	moduleId: string,
): (api: PluginAPI) => PluginObject {
	return () => ({
		name: "apply-react-stabilize-exported-contexts",
		visitor: {
			Program(path: NodePath<types.Program>) {
				const bindings = getReactImportBindings(path.node);
				if (
					bindings.createContext.size === 0 &&
					bindings.namespace.size === 0
				) {
					return;
				}

				const exportedNames = getExportedNames(path.node);
				for (const statement of path.node.body) {
					const declaration = types.isExportNamedDeclaration(statement)
						? statement.declaration
						: statement;
					if (!types.isVariableDeclaration(declaration)) continue;

					for (const declarator of declaration.declarations) {
						if (
							!types.isIdentifier(declarator.id) ||
							!declarator.init ||
							!isCreateContextCall(declarator.init, bindings)
						) {
							continue;
						}

						const exportName = exportedNames.get(declarator.id.name);
						if (!exportName) continue;

						declarator.init = types.callExpression(
							types.identifier("getOrCreateRefreshContext"),
							[
								types.stringLiteral(moduleId),
								types.stringLiteral(exportName),
								types.arrowFunctionExpression([], declarator.init),
							],
						);
					}
				}

				for (const statement of path.node.body) {
					if (
						types.isExportDefaultDeclaration(statement) &&
						types.isExpression(statement.declaration) &&
						isCreateContextCall(statement.declaration, bindings)
					) {
						statement.declaration = types.callExpression(
							types.identifier("getOrCreateRefreshContext"),
							[
								types.stringLiteral(moduleId),
								types.stringLiteral("default"),
								types.arrowFunctionExpression([], statement.declaration),
							],
						);
					}
				}
			},
		},
	});
}

function injectRefreshRuntime(code: string, moduleId: string) {
	const serializedModuleId = JSON.stringify(moduleId);
	return [
		'import { enterReactRefreshModule, getOrCreateRefreshContext } from "@apply-react/react-refresh-runtime.ts";',
		`const __applyReactLeaveRefreshModule = enterReactRefreshModule(${serializedModuleId});`,
		code,
		"__applyReactLeaveRefreshModule();",
	].join("\n");
}

export async function transformReactRefreshModule(
	source: string,
	{ filename, moduleId }: ReactRefreshTransformOptions,
) {
	const result = await transformAsync(source, {
		babelrc: false,
		configFile: false,
		filename,
		parserOpts: { plugins: ["typescript", "jsx"] },
		plugins: [
			stabilizeExportedContexts(moduleId),
			[reactRefreshBabel, { skipEnvCheck: true }],
		],
	});

	if (!result?.code) {
		throw new Error(
			`React Refresh transform produced no output for ${filename}`,
		);
	}

	return injectRefreshRuntime(result.code, moduleId);
}
