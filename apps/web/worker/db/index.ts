import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * as schema from "./schema";

/**
 * Bind Drizzle to the request's D1 binding. Call it per request at the route
 * boundary and pass the result down — the Worker has no module-level state.
 */
export const createDb = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof createDb>;
