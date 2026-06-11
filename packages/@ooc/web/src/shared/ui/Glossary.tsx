import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

/**
 * Glossary —— 轻量术语入口（UI-10）。
 *
 * OOC 的核心名词（stone / flow / pool / object / thread / window）对新用户没有解释。
 * 这里挂一个「这些词是什么」小链接，点开弹层列各词一句话定义。
 *
 * 定义口径取自对象树 `supervisor/knowledge/ooc-glossary.md` 与
 * `children/persistable/self.md`（stone/pool/flow 三层）/ `children/thinkable/self.md`
 * （thread）—— 不自创措辞，保持与权威设计一致。
 */

interface GlossaryTerm {
  term: string;
  definition: string;
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: "object",
    definition:
      "OOC 系统里唯一的一等实体。任何东西要么是一个 object，要么是 object 之间的一条关系。一个 object 持有数据字段 + 程序方法，就是一个 Agent。",
  },
  {
    term: "window",
    definition:
      "ContextWindow —— object 出现在 context 中的形态：既是信息展示单元，又是行动挂载点。window 上挂的 method 就是 object 的 method。thread 持有一组 contextWindows。",
  },
  {
    term: "thread",
    definition:
      "思考过程的运行时节点，持有自己的 context / windows / inbox / outbox / events / status。可在途中创建 sub threads 并行思考。",
  },
  {
    term: "stone",
    definition:
      "设计层（持久 + git 版本化）。持有 object 的长期身份与设计源码：self.md / readable / executable / visible / seed knowledge。低频、走 review。stone = 设计（code），不是数据。",
  },
  {
    term: "pool",
    definition:
      "事实层（持久 + 不进 git）。挂 object 的事实：csv 数据 / 沉淀知识（memory + relations）/ blob 文件。写就生效、单向积累。",
  },
  {
    term: "flow",
    definition:
      "运行层（ephemeral）。单次业务 session 的运行产物（thread / debug / session 级数据）；flow 目录本身即该 session 的 git worktree 根。结束可归档。",
  },
];

export function GlossaryLink({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`glossary-link${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)}
        title="OOC 术语速查"
      >
        <HelpCircle size={12} aria-hidden="true" />
        这些词是什么？
      </button>
      {open && <GlossaryDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function GlossaryDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card glossary-dialog"
        role="dialog"
        aria-label="OOC 术语速查"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row space-between">
          <strong>OOC 术语速查</strong>
          <button
            type="button"
            className="mini-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
        <p className="muted small">
          OOC 用一组核心名词组织上下文与协作；下面是每个词的一句话解释。
        </p>
        <dl className="glossary-list">
          {GLOSSARY_TERMS.map((t) => (
            <div className="glossary-item" key={t.term}>
              <dt className="glossary-term">{t.term}</dt>
              <dd className="glossary-def">{t.definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
