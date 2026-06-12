import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Filesystem window —— filesystem 成员对象在 context 里的窗形态。
 *
 * filesystem 是一个 **tool-object**（被 agent 组合持有的成员对象，非 Agent）：
 * 它把"对文件世界的操作"收成一组连贯方法（grep/glob/open_file/write_file），
 * 这些方法造出 search / file 对象。窗本身只承载身份 + 方法面，无业务数据。
 */
export interface FilesystemWindow extends BaseContextWindow {
  class: "filesystem";
  status: "open" | "closed";
}
