import { trpc } from "../trpc.ts";
import {
  createCluster,
  addNode,
  removeNode,
  scaleNode,
  scaleCluster,
  deleteCluster,
} from "../procedures/cluster.ts";

export const appRouter = trpc.router({
  createCluster,
  addNode,
  removeNode,
  scaleNode,
  scaleCluster,
  deleteCluster,
});

export type AppRouter = typeof appRouter;
