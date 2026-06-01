import { Elysia } from "elysia";
import { healthApi } from "./api.health";

export const healthModule = new Elysia({ prefix: "/api", name: "ooc.health" }).use(healthApi);
