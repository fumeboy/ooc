# Welcome Session Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Welcome out of `MainPanel.tsx` and restyle the session creation form with a minimal local shadcn-like component set.

**Architecture:** Keep business logic in `SessionCreator`, move Welcome page composition into `Welcome.tsx`, and introduce a focused set of reusable UI primitives in `web/src/shared/ui/`. This keeps layout concerns in app/layout, form behavior in domains/sessions, and styling in shared primitives plus `styles.css`.

**Tech Stack:** React 19, TypeScript, existing Tailwind CSS import pipeline, class-variance-authority, clsx, tailwind-merge, lucide-react.

---

### Task 1: Split Welcome from MainPanel

**Files:**
- Create: `web/src/app/layout/Welcome.tsx`
- Modify: `web/src/app/layout/MainPanel.tsx`

- [ ] **Step 1: Create `Welcome.tsx` and move Welcome markup into it**

```tsx
import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import type { Stone } from "../../domains/stones";

export function Welcome({ stones, onCreateSession }: {
  stones: Stone[];
  onCreateSession?: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void>;
}) {
  return (
    <div className="welcome-shell">
      <div className="welcome-stack">
        <div className="welcome-hero">
          <strong className="welcome-title">Welcome</strong>
          <div className="welcome-copy">
            Create or continue a flow session from the left sidebar, then inspect files and root thread activity from this control surface.
          </div>
        </div>
        <div className="welcome-card">
          <div className="welcome-card-head">
            <strong>Create session</strong>
            <div className="muted small">Choose an entry object and optional initial message to create the next flow.</div>
          </div>
          {onCreateSession && <SessionCreator stones={stones} onCreate={onCreateSession} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `MainPanel.tsx` to render `Welcome`**

```tsx
import { Welcome } from "./Welcome";

{isWelcome ? (
  <Welcome stones={stones} onCreateSession={onCreateSession} />
) : (
  <FileViewer ... />
)}
```

- [ ] **Step 3: Verify the MainPanel file stays focused on layout orchestration**

Run: no command; inspect `web/src/app/layout/MainPanel.tsx`
Expected: Welcome-specific inline styles and long markup are removed.

### Task 2: Add minimal local shadcn-like primitives

**Files:**
- Modify: `web/src/shared/ui/Button.tsx`
- Create: `web/src/shared/ui/card.tsx`
- Create: `web/src/shared/ui/input.tsx`
- Create: `web/src/shared/ui/textarea.tsx`
- Create: `web/src/shared/ui/label.tsx`
- Create: `web/src/shared/ui/select.tsx`

- [ ] **Step 1: Upgrade Button to support variants and sizes**

```tsx
import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "primary",
      outline: "btn-outline",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "btn-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export function Button({ className = "", variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={twMerge(buttonVariants({ variant, size }), className)} {...props} />;
}
```

- [ ] **Step 2: Add focused card/input/textarea/label/select wrappers**

```tsx
export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={twMerge("panel ui-card", className)} {...props} />;
}
```

```tsx
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={twMerge("input ui-input", props.className)} {...props} />;
}
```

```tsx
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={twMerge("textarea ui-textarea", props.className)} {...props} />;
}
```

```tsx
export function Label({ className = "", ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={twMerge("ui-label", className)} {...props} />;
}
```

```tsx
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={twMerge("input ui-select", props.className)} {...props} />;
}
```

- [ ] **Step 3: Keep the primitive scope minimal**

Run: no command; inspect created files
Expected: Only Welcome form dependencies are added; no extra unused primitives are introduced.

### Task 3: Restyle SessionCreator with new primitives

**Files:**
- Modify: `web/src/domains/sessions/components/SessionCreator.tsx`

- [ ] **Step 1: Replace raw fields with labeled primitive-based fields**

```tsx
import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Select } from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";

<div className="welcome-form-grid">
  <div className="welcome-form-field">
    <Label htmlFor="session-id">Session ID</Label>
    <Input id="session-id" value={sessionId} onChange={...} placeholder="session id" />
  </div>
</div>
```

- [ ] **Step 2: Add empty-state notice and keep disabled behavior**

```tsx
{stones.length === 0 && (
  <div className="welcome-form-notice">
    需要先创建至少一个 stone，才能选择入口 object。
  </div>
)}
```

- [ ] **Step 3: Keep submit logic unchanged while updating CTA styling**

```tsx
<Button variant="primary" size="lg" disabled={busy || !sessionId || !objectId} onClick={async () => {
  setBusy(true);
  try {
    await onCreate({ sessionId, objectId, initialMessage });
    setSessionId(defaultSessionId());
    setInitialMessage("");
  } finally {
    setBusy(false);
  }
}}>
  {busy ? "Creating…" : "Create session"}
</Button>
```

### Task 4: Add page and field styling

**Files:**
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add Welcome layout styles**

```css
.welcome-shell { min-height: 100%; display: grid; place-items: center; padding: 24px; }
.welcome-stack { width: min(640px, 100%); display: grid; gap: 18px; }
.welcome-hero { display: grid; gap: 8px; text-align: center; }
.welcome-title { font-size: 28px; line-height: 1.15; }
.welcome-copy { color: var(--muted-foreground); font-size: 13px; }
.welcome-card { display: grid; gap: 14px; padding: 20px; }
.welcome-card-head { display: grid; gap: 4px; }
```

- [ ] **Step 2: Add lightweight field styles for primitives**

```css
.ui-card { background: rgba(255,255,255,.78); }
.ui-label { display: inline-flex; font-size: 12px; font-weight: 600; color: #5d655c; margin-bottom: 6px; }
.ui-input, .ui-textarea, .ui-select { background: rgba(255,255,255,.96); border-color: rgba(224, 227, 220, .96); }
.welcome-form-grid { display: grid; gap: 12px; }
.welcome-form-field { display: grid; gap: 6px; }
.welcome-form-notice { border: 1px solid #f0d8d2; background: #fff7f5; color: #9a463b; border-radius: 10px; padding: 10px 12px; font-size: 12px; }
```

- [ ] **Step 3: Add button utility variants used by Button cva**

```css
.btn-outline { background: transparent; border-color: var(--border); color: var(--foreground); }
.btn-sm { padding: 6px 10px; font-size: 12px; }
.btn-lg { padding: 10px 14px; font-size: 14px; }
```

### Task 5: Verify behavior and build

**Files:**
- Test: `web/src/app/layout/MainPanel.tsx`
- Test: `web/src/app/layout/Welcome.tsx`
- Test: `web/src/domains/sessions/components/SessionCreator.tsx`
- Test: `web/src/shared/ui/Button.tsx`
- Test: `web/src/styles.css`

- [ ] **Step 1: Run TypeScript typecheck**

Run: `cd "~/x/ooc/ooc-2/web" && ./node_modules/.bin/tsc --noEmit -p ./tsconfig.json`
Expected: exit code 0

- [ ] **Step 2: Run production build in temp directory**

Run: `cd "~/x/ooc/ooc-2/web" && tmpdir=$(mktemp -d "/tmp/ooc-web-build-XXXXXX") && ./node_modules/.bin/vite build --outDir "$tmpdir" --emptyOutDir && rm -rf "$tmpdir"`
Expected: build completes successfully

- [ ] **Step 3: Manual spot-check checklist**

Run: no command; inspect the running UI if needed
Expected:
- Welcome page still centers content
- Form fields are visually upgraded
- Empty-stone state disables object select and submit button
- Non-Welcome file view still renders through `FileViewer`
