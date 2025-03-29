import { appRouter } from "./router/index.ts";
import { trpc } from "./trpc.ts";

// Create a tRPC caller for direct procedure calls
export const caller = trpc.createCallerFactory(appRouter)({});