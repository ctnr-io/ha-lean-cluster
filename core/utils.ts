import * as util from "node:util";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { time } from "node:console";

export const NodeRoles = ["control-plane", "etcd", "worker"] as const;
export type NodeRoles = (typeof NodeRoles)[number][];
export type NodeRole = (typeof NodeRoles)[number];

export const sh = (template: { raw: readonly string[] | ArrayLike<string> }, ...substitutions: any[]): string => {
  const str = String.raw(template, ...substitutions);
  return str.trim();
};
export const yaml = (template: { raw: readonly string[] | ArrayLike<string> }, ...substitutions: any[]): string => {
  let str = String.raw(template, ...substitutions);
  // calculate indentation
  const indentation =
    str
      .split("\n")
      .filter((line) => line.match(/\w/))[0]
      .match(/^\s+/)?.[0] ?? "";
  // remove indentation
  str = str.replace(new RegExp(`^${indentation}`, "gm"), "");
  return str;
};

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
export async function exec(command: string, input?: string): Promise<string> {
  console.log(`Executing: ${command} ${input ? `<<< ${input}` : ""}`);

  try {
    // Use execFile instead of spawn directly to handle the command parsing
    const output = await new Promise<string>((resolve, reject) => {
      // Use shell: true to execute the command in a shell
      const child = childProcess.execFile("/bin/sh", ["-c", command], { shell: false }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout + stderr);
      });

      if (input && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });

    return output;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Command failed: ${errorMessage}`);
    throw new Error(`Failed to execute command: ${errorMessage}`);
  }
}

/**
 * Execute an SSH command on a remote host
 */
export async function executeSSH(
  host: string,
  command: string,
  input?: string,
  options?: {
    retries?: number;
    timeout?: number;
  }
): Promise<[stdout: string, stderr: string]> {
  const sshArgs = [
    "-i",
    "private.key",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    ...(options?.timeout ? ["-o", `ConnectTimeout=${options.timeout / 1000}`] : []),
    `root@${host}`,
  ];
  console.log(`Executing: ssh ${sshArgs.join(" ")}\n${command} ${input ? `<<< ${input}` : ""}`);

  try {
    return await retry({
      fn: () =>
        new Promise<[stdout: string, stderr: string]>((resolve, reject) => {
          // Use shell: true to execute the command in a shell
          const child = childProcess.execFile(
            "ssh",
            [...sshArgs, command],
            { shell: false },
            (error, stdout, stderr) => {
              if (error) {
                console.warn(stderr);
                reject(error);
                return;
              }
              console.log(stdout)
              resolve([stdout, stderr]);
            }
          );

          if (input && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
          }
        }),
      maxRetries: options?.retries ?? 0,
      timeout: options?.timeout ? options?.timeout * ((options?.retries ?? 0) + 1) : Infinity,
      interval: options?.timeout,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Command failed: ${errorMessage}`);
    throw new Error(`Failed to execute command: ${errorMessage}`);
  }
}

/**
 * Paginate through a list of items via function `fn` and return all the items
 */
export async function* paginateAll<T>(options: {
  request: (options: { page: number; size: number }) => Promise<T[]>;
  sorter?: (a: T, b: T) => number;
  pageSize?: number;
  maxPages?: number;
}): AsyncGenerator<T> {
  for await (const item of paginateFilter({ ...options, condition: () => true })) {
    yield item;
  }
}

/**
 * Paginate through a list of items via function `fn` and return the first item that satisfies the condition `condition`.
 */
export async function paginateFind<T>(options: {
  request: (options: { page: number; size: number }) => Promise<T[]>;
  condition: (item: T) => Promise<boolean> | boolean;
  sorter?: (a: T, b: T) => number;
  pageSize?: number;
  maxPages?: number;
  error?: Error;
}): Promise<T> {
  for await (const item of paginateFilter(options)) {
    return item;
  }
  throw options.error ?? new Error("PaginateFind: Item not found");
}

/**
 * Paginate through a list of items via function `fn` and return the all items that satisfies the condition `condition`.
 */
export async function* paginateFilter<T>(options: {
  request: (options: { page: number; size: number }) => Promise<T[]>;
  condition: (item: T) => Promise<boolean> | boolean;
  sorter?: (a: T, b: T) => number;
  pageSize?: number;
  maxPages?: number;
}): AsyncGenerator<T> {
  const { maxPages = Infinity, pageSize = 100, request, condition, sorter } = options;
  for (let page = 1; page <= maxPages; page++) {
    let itemsPage = await request({ page, size: pageSize });
    if (sorter) {
      itemsPage = itemsPage.sort(sorter);
    }
    for (const item of itemsPage) {
      try {
        if (await condition(item)) {
          yield item;
        }
      } catch {
        // ignore errors
      }
    }
    if (itemsPage.length < pageSize) {
      break;
    }
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(options: {
  condition: () => Promise<boolean>;
  timeout?: number;
  interval?: number;
  errorMessage?: string;
}): Promise<void> {
  const { condition, timeout = 10000, interval = 1000, errorMessage = "Wait for condition: timed out" } = options;
  const start = performance.now();
  while (true) {
    const result = await condition();
    if (result) {
      return;
    }
    if (performance.now() - start > timeout) {
      throw new Error(errorMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
  
/**
 * Retry a function until it succeed nth times or timeout
 */
export async function retry<T>(options: {
  fn: () => Promise<T>;
  maxRetries?: number;
  interval?: number;
  timeout?: number;
}): Promise<T> {
  const { fn, maxRetries = 3, interval = 1000, timeout = 10000 } = options;
  let retries = 0;
  const start = performance.now();
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (retries >= maxRetries || performance.now() - start > timeout) {
        throw error;
      }
      retries++;
      console.log(`Retrying... (${retries}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

/**
 * Find the first item that satisfies the condition in an async generator
 */
export async function findAsync<T>(options: {
  generator: AsyncGenerator<T>;
  condition: (item: T) => Promise<boolean> | boolean;
  notFoundError?: Error;
}): Promise<T> {
  for await (const item of filterAsync(options)) {
    return item;
  }
  throw options.notFoundError ?? new Error("Item not found");
}

/**
 * Filter an async generator by condition
 */
export async function* filterAsync<T>(options: {
  generator: AsyncGenerator<T>;
  condition: (item: T) => Promise<boolean> | boolean;
}): AsyncGenerator<T> {
  for await (const item of options.generator) {
    try {
      if (await options.condition(item)) {
        yield item;
      }
    } catch {
      // ignore errors
    }
  }
}

/**
 * Get the nth item in an async generator
 */
export async function nthAsync<T>(options: {
  generator: AsyncGenerator<T>;
  n: number;
  notFoundError?: Error;
}): Promise<T> {
  let i = 0;
  for await (const item of options.generator) {
    if (i === options.n) {
      return item;
    }
    i++;
  }
  throw options.notFoundError ?? new Error(`Item ${options.n} not found`);
}

/**
 *
 * Get the first item in an async generator
 */
export async function firstAsync<T>(options: { generator: AsyncGenerator<T>; notFoundError?: Error }): Promise<T> {
  for await (const item of options.generator) {
    console.log(item);
    return item;
  }
  throw options.notFoundError ?? new Error("Item not found");
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
        Deno.exit(1);
      }
    });
  });
}
