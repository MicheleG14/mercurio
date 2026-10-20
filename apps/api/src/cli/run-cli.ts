import type { INestApplicationContext } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { DomainException } from '../shared/errors/index.js';
import { type CliIo, COMMANDS, resolveServices } from './commands.js';

/** Exit codes: 0 done, 1 refused by a rule or failed, 2 wrong usage. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

/**
 * Runs one command. The application context is created only when a command will actually run,
 * so `help` works without a database. Returns the exit code instead of exiting, for tests.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  createApp: () => Promise<INestApplicationContext>,
): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help') {
    printHelp(io);
    return name ? EXIT.ok : EXIT.usage;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.err(`Unknown command: ${name}`);
    printHelp(io);
    return EXIT.usage;
  }

  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({ args: [...rest], options: command.options, strict: true })
      .values as Record<string, string | undefined>;
  } catch (error) {
    io.err((error as Error).message);
    printUsage(io, name);
    return EXIT.usage;
  }
  const missing = command.required.filter((option) => !values[option]?.trim());
  if (missing.length > 0) {
    io.err(`Missing: ${missing.map((option) => `--${option}`).join(', ')}`);
    printUsage(io, name);
    return EXIT.usage;
  }

  const app = await createApp();
  try {
    await command.run(resolveServices(app), values, io);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof DomainException) {
      io.err(`Refused: ${error.code}${error.detail ? ` (${error.detail})` : ''}`);
      return EXIT.failed;
    }
    io.err(`Failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return EXIT.failed;
  } finally {
    await app.close();
  }
}

function printHelp(io: CliIo): void {
  io.out('Usage: cli <command> [--option value ...]');
  io.out('');
  for (const [name, command] of Object.entries(COMMANDS)) {
    io.out(`  ${name.padEnd(14)} ${command.summary}`);
  }
  io.out('');
  io.out('A command run without its required options prints its usage.');
}

function printUsage(io: CliIo, name: string): void {
  const command = COMMANDS[name]!;
  const options = Object.keys(command.options).map((option) =>
    command.required.includes(option) ? `--${option} <value>` : `[--${option} <value>]`,
  );
  io.err(`Usage: cli ${name} ${options.join(' ')}`);
}
