/**
 * Flow 状态管理（Jotai atoms）
 *
 * @ref docs/哲学文档/gene.md#G2 — references — Flow 列表与选中状态
 */
import { atom } from "jotai";
import type { FlowSummary, FlowData } from "../api/types";

/** 当前对象的 Flow 列表 */
export const flowsAtom = atom<FlowSummary[]>([]);

/** 当前查看的 Flow 详情 */
export const selectedFlowAtom = atom<FlowData | null>(null);
