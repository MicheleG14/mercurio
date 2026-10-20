import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { CliModule } from './cli/cli.module.js';
import { runCli } from './cli/run-cli.js';

// Entry point of the terminal commands: `node dist/cli.js <command> ...`
// (in production: `docker compose run --rm cli <command> ...`). Human-readable output goes to
// stdout; one JSON audit line per completed command goes to stderr, for the logs.
const audit = pino({ base: { component: 'cli' } }, pino.destination(2));

process.exitCode = await runCli(
  process.argv.slice(2),
  {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    audit: (event) => audit.info(event, 'command completed'),
  },
  () => NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] }),
);
