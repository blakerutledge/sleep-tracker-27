const printUsage = (): void => {
    console.log(
        'Usage: mise run validate [options]\n\nOptions:\n  -h, --help      Show this help message',
    )
}

const parseArgs = (argv: readonly string[]): void => {
    for (const arg of argv) {
        if (arg === '-h' || arg === '--help') {
            printUsage()
            process.exit(0)
        }
        console.error(`Error: Unknown argument '${arg}'`)
        printUsage()
        process.exit(1)
    }
}

const printTaskTree = async (): Promise<void> => {
    const proc = Bun.spawn(['mise', 'tasks', 'deps', 'validate-raw'], {
        stdout: 'pipe',
        stderr: 'ignore',
    })
    const raw = await new Response(proc.stdout).text()
    await proc.exited

    const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean)
    const leafCount = Math.max(0, lines.length - 1)

    console.log('\x1b[90m#\x1b[0m')
    console.log(`\x1b[1;34m# Validation task will run the following ${leafCount} sub-tasks:\x1b[0m`)
    console.log('\x1b[90m#\x1b[0m')

    for (const [idx, line] of lines.entries()) {
        const match = /^(.*[├└]── )(\S+)(.*)$/.exec(line)
        if (idx > 0 && match) {
            console.log(`\x1b[90m${match[1]}\x1b[32m${match[2]}\x1b[0m${match[3]}`)
        } else {
            console.log(`\x1b[90m${line}\x1b[0m`)
        }
    }
    console.log('')
}

const printFailureSummary = (output: string): void => {
    const lines = output.split(/\r?\n/)
    const failedPrefixes = new Set<string>()
    const linePrefixes: Array<string | null> = []

    for (const line of lines) {
        const match = /\[([^\]]+)\]/.exec(line)
        const prefix = match ? `[${match[1]}]` : null
        linePrefixes.push(prefix)
        if (
            prefix &&
            prefix !== '[validate]' &&
            prefix !== '[validate-raw]' &&
            (line.includes('ERROR') || line.includes('exited with status'))
        ) {
            failedPrefixes.add(prefix)
        }
    }

    if (failedPrefixes.size === 0) return

    console.log('')
    console.log('\x1b[1;31m-----------------------------------------------------')
    console.log('Validation errors')
    console.log('-----------------------------------------------------\x1b[0m')

    let prevPrefix = ''
    for (const [idx, line] of lines.entries()) {
        const prefix = linePrefixes[idx]
        if (!prefix || !failedPrefixes.has(prefix)) continue
        if (
            (line.includes('ERROR') && line.includes('task failed')) ||
            line.includes('exited with status')
        ) {
            continue
        }
        if (prevPrefix !== '' && prevPrefix !== prefix) {
            console.log('\x1b[1;31m-----------------------------------------------------\x1b[0m')
        }
        prevPrefix = prefix
        console.log(line)
    }
    console.log('\x1b[1;31m-----------------------------------------------------\x1b[0m')
    console.log('')
}

const runValidate = async (): Promise<void> => {
    parseArgs(Bun.argv.slice(2))
    await printTaskTree()

    const isTty = Boolean(process.stdout.isTTY)
    const frames = ['|', '/', '-', '\\']
    let frameIdx = 0
    const startMs = Date.now()
    let spinner: ReturnType<typeof setInterval> | null = null

    const stopSpinner = (): void => {
        if (!spinner) return
        clearInterval(spinner)
        spinner = null
        if (isTty) {
            process.stderr.write('\r\x1b[K\x1b[?25h')
        }
    }

    if (isTty) {
        process.stderr.write('\x1b[?25l')
        spinner = setInterval(() => {
            const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
            const frame = frames[frameIdx % frames.length] ?? '|'
            frameIdx += 1
            process.stderr.write(
                `\r\x1b[36m${frame}\x1b[0m Running all tasks in parallel, collecting outputs... (${elapsed}s)`,
            )
        }, 100)
    }

    process.on('SIGINT', () => {
        stopSpinner()
        process.exit(130)
    })

    const env: Record<string, string | undefined> = {
        ...process.env,
        ...Object.fromEntries([
            ['CLICOLOR_FORCE', '1'],
            ['FORCE_COLOR', '1'],
            ['MISE_COLOR', '1'],
            ['TERM', process.env.TERM ?? 'xterm-256color'],
            ['COLORTERM', process.env.COLORTERM ?? 'truecolor'],
        ]),
    }

    const proc = Bun.spawn(['mise', 'run', '--continue-on-error', 'validate-raw'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
    })

    const [stdoutText, stderrText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])

    stopSpinner()

    const combined = [stdoutText, stderrText].filter(Boolean).join('')
    if (combined) {
        process.stdout.write(combined)
    }

    if (exitCode !== 0) {
        printFailureSummary(combined)
    } else {
        console.log('')
        console.log('\x1b[1;32m-----------------------------------------------------')
        console.log('All validations (lints, checks, and tests) passed.')
        console.log('-----------------------------------------------------\x1b[0m')
    }

    process.exit(exitCode)
}

await runValidate()
