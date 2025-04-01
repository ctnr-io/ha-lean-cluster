import * as util from "node:util";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";

export const NodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRoles = (typeof NodeRoles)[number][];
export type NodeRole = (typeof NodeRoles)[number];

const _exec = util.promisify(childProcess.exec);

export const sh = (template: { raw: readonly string[] | ArrayLike<string> }, ...substitutions: any[]): string => {
  const str = String.raw(template, ...substitutions);
  return str
    .replace(/[\\\n]/g, "")
    .replace(/[\s\t]+/g, " ")
    .trim();
};
export const yaml = String.raw;

/**
 * Ensure a directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create directory ${dir}: ${errorMessage}`);
    throw new Error(`Failed to create directory ${dir}: ${errorMessage}`);
  }
}

/**
 * Write content to a file
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, "utf8");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to write to file ${filePath}: ${errorMessage}`);
    throw new Error(`Failed to write to file ${filePath}: ${errorMessage}`);
  }
}

/**
 * Read content from a file
 */
export async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read file ${filePath}: ${errorMessage}`);
    throw new Error(`Failed to read file ${filePath}: ${errorMessage}`);
  }
}

/**
 * Execute a command and return the output
 */
export async function exec(command: string): Promise<string> {
  console.log(`Executing: ${command}`);

  try {
    const { stdout, stderr } = await _exec(command);
    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Command failed: ${errorMessage}`);
    throw new Error(`Failed to execute command: ${errorMessage}`);
  }
}

/**
 * Execute an SSH command on a remote host
 */
export async function executeSSH(host: string, command: string): Promise<string> {
  return await exec(
    `ssh -i private.key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${host} '${command}'`
  );
}

export const Signals = [
  "SIGABRT",
  "SIGALRM",
  "SIGBREAK",
  "SIGBUS",
  "SIGCHLD",
  "SIGCONT",
  "SIGEMT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINFO",
  "SIGINT",
  "SIGIO",
  "SIGPOLL",
  "SIGUNUSED",
  "SIGKILL",
  "SIGPIPE",
  "SIGPROF",
  "SIGPWR",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTKFLT",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGWINCH",
  "SIGXCPU",
  "SIGXFSZ",
] as const;
export type Signal = (typeof Signals)[number];

export const TerminationSignals = [
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGEMT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGIO",
  "SIGKILL",
  "SIGPIPE",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTOP",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGXCPU",
  "SIGXFSZ",
] as const;
export type TerminationSignal = (typeof TerminationSignals)[number];

export const AllowedTerminationSignals = [
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGEMT",
  "SIGHUP",
  "SIGINT",
  "SIGIO",
  "SIGPIPE",
  "SIGQUIT",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGXCPU",
  "SIGXFSZ",
] as const;
export type AllowedTerminationSignal = (typeof AllowedTerminationSignals)[number];

export function handleTerminationSignals(callback: (signal: AllowedTerminationSignal) => unknown) {
  AllowedTerminationSignals.forEach((signal) => {
    Deno.addSignalListener(signal, async () => {
      console.log(`Received ${signal}`);
      try {
        await callback(signal);
        Deno.exit(0);
      } catch (error) {
        console.error(`Error during termination signal handling: ${error}`);
        Deno.exit(1)
      }
    });
  });
}