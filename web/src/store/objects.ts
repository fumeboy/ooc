/**
 * 对象状态管理（Jotai atoms）
 *
 * @ref .ooc/docs/哲学文档/gene.md#G1 — references — 对象列表与选中状态
 */
import { atom } from "jotai";
import type { ObjectSummary } from "../api/types";

/** 所有对象列表 */
export const objectsAtom = atom<ObjectSummary[]>([]);

/** 当前选中的对象名（侧边栏） */
export const selectedObjectAtom = atom<string | null>(null);
