import { trpc } from "./trpc.ts";
import { appRouter } from "./router/index.ts";
import { createCli } from "trpc-cli";

export const cli = createCli({
  router: appRouter,
  createCallerFactory: trpc.createCallerFactory,
});

cli.run();
