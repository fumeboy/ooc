/**
 * ooc:// 链接弹窗状态管理
 */
import { atom } from "jotai";

/** 当前打开的 ooc:// URL（null 表示关闭弹窗） */
export const oocLinkUrlAtom = atom<string | null>(null);
