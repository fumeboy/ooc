/**
 * render-spec — visible 层 ObjectClientRenderer 纯函数核心（spec §5.2）。
 *
 * 把 ObjectRecord + slice 配置转换为通用 UI 描述 JSON。
 * 不依赖 React/DOM；可用于测试、SSR、CLI 预览。
 */

/** 单个 slice（可来自自身或 prototype 链任意层）。 */
export type Slice = {
    /** slice 名称（如 "self", "pool", "methods", "talk"） */
    name: string;
    /** slice 显示标题 */
    label: string;
    /** slice 内容（结构化数据，由各层 client 定义） */
    content: unknown;
};

/** method 按钮描述。 */
export type MethodButton = {
    /** method 名 */
    name: string;
    /** HTTP 路径（相对）*/
    path: string;
    /** 参数 schema（JSON Schema subset，可选）*/
    params?: Record<string, { type: string; description?: string }>;
};

/** talk 输入区描述。 */
export type TalkInputSpec = {
    placeholder: string;
    /** 提交的 endpoint */
    endpoint: string;
};

/** renderObject 的最终输出：通用 UI 描述 JSON。 */
export type RenderSpec = {
    /** 对象 URI */
    uri: string;
    /** 对象标题（来自 self.md frontmatter title 或 name）*/
    title: string;
    /** header 区：关键字段一览 */
    header: {
        kind: string;
        layer: string;
        extendsChain: string[];
    };
    /** 各 slice 按顺序展示 */
    sections: Slice[];
    /** talk 输入区（null = 该 Object 不支持 talk）*/
    talkInput: TalkInputSpec | null;
    /** method 按钮列表 */
    methodButtons: MethodButton[];
};

/**
 * 最小化 ObjectRecord 接口（避免直接依赖 src/，保持 web 层独立）。
 * 实际使用时可直接传入 src/persistable/object-record.ts 中的 ObjectRecord。
 */
export interface MinimalRecord {
    uri: string;
    kind: string;
    self: {
        extends?: string;
        title?: string;
        [key: string]: unknown;
    };
    serverPublic?: Record<string, unknown>;
}

/**
 * 把 ObjectRecord + slices 转换为通用 UI 描述 JSON。
 *
 * @param record  ObjectRecord（或兼容的最小形态）
 * @param slices  经 prototype 链 fallback 合并后的 slice 列表
 * @param opts    可选配置
 */
export function renderObject(
    record: MinimalRecord,
    slices: Slice[],
    opts: {
        /** prototype 链（从自身到 root），用于 header.extendsChain */
        chain?: string[];
        /** 是否支持 talk（默认 true）*/
        talkable?: boolean;
    } = {},
): RenderSpec {
    const { chain = [], talkable = true } = opts;

    // 标题：优先 self.md frontmatter title，fallback 到 URI 末段
    const title =
        typeof record.self.title === "string"
            ? record.self.title
            : record.uri.split("/").pop() ?? record.uri;

    // URI 中 layer 段
    const layer = record.uri.startsWith("ooc://")
        ? (record.uri.slice("ooc://".length).split("/")[0] ?? "unknown")
        : "unknown";

    // method 按钮：从 serverPublic 推断（key = method name）
    const methodButtons: MethodButton[] = record.serverPublic
        ? Object.keys(record.serverPublic).map((name) => ({
              name,
              path: `/api/objects/${encodeURIComponent(record.uri)}/methods/${name}`,
          }))
        : [];

    // talk 输入区
    const talkInput: TalkInputSpec | null = talkable
        ? {
              placeholder: `Message ${title}...`,
              endpoint: `/api/talk`,
          }
        : null;

    return {
        uri: record.uri,
        title,
        header: {
            kind: record.kind,
            layer,
            extendsChain: chain,
        },
        sections: slices,
        talkInput,
        methodButtons,
    };
}
