import type { FlowSession } from "../../flows";
import { FlowList } from "../../flows/components/FlowList";

export function SessionList(props: { flows: FlowSession[]; activeSessionId?: string; onSelect: (flow: FlowSession) => void }) {
  return <FlowList {...props} />;
}

