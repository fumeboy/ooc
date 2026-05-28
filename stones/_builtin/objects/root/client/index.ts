/**
 * stones/_builtin/objects/root/client/index.ts
 *
 * OOC-3 根原型的自定义 UI 占位（render-spec，无 JSX 依赖）。
 * 任何 Object 渲染时，若自身无 client/index.ts，沿 prototype 链 fallback 最终到这里（spec §5.2）。
 *
 * P4 阶段：返回 render-spec 结构体；真实 React 渲染在 P7（visible / web）连线。
 */

/**
 * Object 渲染时 host 注入的 props。
 */
export type RootObjectViewProps = {
    /** Object 的 ooc:// URI */
    uri: string;
    /** Object frontmatter (主要为 title / description / extends 等) */
    self: Record<string, unknown>;
    /** 由 defaultContext() 计算的 slices；由 host 注入 */
    slices?: Array<{ kind: string; payload: unknown }>;
    /** 是否只读（历史 flow / ephemeral session 结束后只读） */
    readOnly?: boolean;
};

/**
 * RenderSpec: P4 阶段的 UI 占位描述结构。
 * P7 将把这个结构映射到真实 React 组件树。
 */
export type RenderSpec = {
    type: "root-object-view";
    props: RootObjectViewProps;
    /** 组件版本，供 P7 做兼容性检查 */
    version: "p4-placeholder";
};

/**
 * 默认 Object 视图 render-spec 构造函数。
 *
 * 子原型通过 override 此函数提供自定义渲染描述。
 */
export function renderRootObjectView(props: RootObjectViewProps): RenderSpec {
    return {
        type: "root-object-view",
        props,
        version: "p4-placeholder",
    };
}

/**
 * 默认导出：render-spec factory，供 loader 动态 import 后调用。
 * P7 host 约定：default export 是 (props) => RenderSpec。
 */
export default renderRootObjectView;
