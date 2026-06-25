/**
 * agent —— executable 维度。agency = `talk`。
 *
 * `end` / `todo` 属 thread 作用域，不在 agent agency。
 */
import type { ExecutableModule } from "@ooc/core/types/index.js";
import type { Data } from "../types.js";
import { talkMethod } from "./method.talk.js";

const executable: ExecutableModule<Data> = {
  methods: [talkMethod],
};

export default executable;
