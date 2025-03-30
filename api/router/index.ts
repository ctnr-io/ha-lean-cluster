import { trpc } from "../trpc.ts";


export const appRouter = trpc.router({
});

export type AppRouter = typeof appRouter;
