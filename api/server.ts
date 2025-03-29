import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from "./router/index.ts";

const server = createHTTPServer({
  router: appRouter,
});
 
server.listen(3000);