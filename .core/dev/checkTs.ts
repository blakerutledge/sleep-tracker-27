import ts from 'typescript'
import initCssModulesPlugin from 'typescript-plugin-css-modules'

interface PluginConfig {
    name?: string
    options?: Record<string, unknown>
}

const isPluginConfig = (value: unknown): value is PluginConfig =>
    typeof value === 'object' && value !== null

const getCssModulesPluginConfig = (compilerOptions: ts.CompilerOptions): PluginConfig => {
    const plugins: unknown = compilerOptions.plugins
    if (!Array.isArray(plugins)) {
        return { name: 'typescript-plugin-css-modules' }
    }
    const found = plugins.find(
        (plugin): plugin is PluginConfig =>
            isPluginConfig(plugin) && plugin.name === 'typescript-plugin-css-modules',
    )
    return found ?? { name: 'typescript-plugin-css-modules' }
}

const checkCssModulesTs = (projectDir: string = ts.sys.getCurrentDirectory()): void => {
    const configPath = ts.sys.resolvePath(`${projectDir}/tsconfig.json`)
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    if (configFile.error) {
        console.error(
            ts.formatDiagnosticsWithColorAndContext([configFile.error], {
                getCanonicalFileName: (fileName) => fileName,
                getCurrentDirectory: () => projectDir,
                getNewLine: () => ts.sys.newLine,
            }),
        )
        ts.sys.exit(1)
    }

    const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        projectDir,
        undefined,
        configPath,
    )
    const pluginConfig = getCssModulesPluginConfig(parsed.options)
    const cssErrors: string[] = []
    const compilerHost = ts.createCompilerHost(parsed.options)
    const originalGetSourceFile = compilerHost.getSourceFile.bind(compilerHost)

    let proxiedHost: ts.LanguageServiceHost | undefined
    const tsWithHostCapture: typeof ts = {
        ...ts,
        createLanguageService: (host, documentRegistry, syntaxOnlyOrLanguageServiceMode) => {
            proxiedHost = host
            return ts.createLanguageService(host, documentRegistry, syntaxOnlyOrLanguageServiceMode)
        },
    }

    const baseLanguageServiceHost: ts.LanguageServiceHost = {
        getCompilationSettings: () => parsed.options,
        getScriptFileNames: () => parsed.fileNames,
        getScriptVersion: () => '0',
        getScriptKind: () => ts.ScriptKind.Unknown,
        getScriptSnapshot: (fileName) => {
            const text = ts.sys.readFile(fileName)
            return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined
        },
        getCurrentDirectory: () => projectDir,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
        resolveModuleNameLiterals: (moduleLiterals, containingFile, redirectedReference, options) =>
            moduleLiterals.map((literal) =>
                ts.resolveModuleName(
                    literal.text,
                    containingFile,
                    options,
                    compilerHost,
                    undefined,
                    redirectedReference,
                ),
            ),
    }

    const pluginModule = initCssModulesPlugin({ typescript: tsWithHostCapture })
    // TypeScript's PluginCreateInfo requires a ts.server.Project instance, which cannot be
    // instantiated outside tsserver; we provide the exact minimal subset read by the plugin.
    const pluginCreateInfo = {
        config: pluginConfig,
        languageService: {} as ts.LanguageService,
        languageServiceHost: baseLanguageServiceHost,
        project: {
            getCurrentDirectory: () => projectDir,
            getCompilerOptions: () => parsed.options,
            projectService: {
                logger: {
                    info: (msg: string) => {
                        if (msg.includes('Failed with error:')) {
                            cssErrors.push(msg)
                        }
                    },
                },
            },
        } as unknown as ts.server.Project,
        serverHost: {} as ts.server.ServerHost,
    } satisfies ts.server.PluginCreateInfo

    pluginModule.create(pluginCreateInfo)

    if (proxiedHost) {
        const activeHost = proxiedHost
        compilerHost.getSourceFile = (
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
        ) => {
            if (activeHost.getScriptKind?.(fileName) === ts.ScriptKind.TS) {
                const snapshot = activeHost.getScriptSnapshot(fileName)
                if (snapshot) {
                    return ts.createSourceFile(
                        fileName,
                        snapshot.getText(0, snapshot.getLength()),
                        languageVersion,
                    )
                }
            }
            return originalGetSourceFile(
                fileName,
                languageVersion,
                onError,
                shouldCreateNewSourceFile,
            )
        }

        if (activeHost.resolveModuleNameLiterals) {
            compilerHost.resolveModuleNameLiterals =
                activeHost.resolveModuleNameLiterals.bind(activeHost)
        }
    }

    const program = ts.createProgram(parsed.fileNames, parsed.options, compilerHost)
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]

    if (cssErrors.length > 0) {
        for (const err of cssErrors) {
            console.error(`CSS Module compilation error: ${err}`)
        }
    }

    if (diagnostics.length > 0) {
        console.error(
            ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                getCanonicalFileName: (fileName) => fileName,
                getCurrentDirectory: () => projectDir,
                getNewLine: () => ts.sys.newLine,
            }),
        )
    }

    if (cssErrors.length > 0 || diagnostics.length > 0) {
        ts.sys.exit(1)
    }
}

const targetArg = Bun.argv[2]
const targetDir = targetArg ? ts.sys.resolvePath(targetArg) : ts.sys.getCurrentDirectory()
checkCssModulesTs(targetDir)
