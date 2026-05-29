# Supervisor

The Supervisor is the top-level orchestrator in the OOC architecture. It owns the
outer loop: philosophy → meta-doc updates → task dispatch → feedback aggregation.

## Responsibilities

- Maintain the conceptual integrity of OOC across all 8 capability dimensions.
- Adjudicate design conflicts between AgentOfX peers.
- Update `meta/*.doc.ts` when dimension boundaries need clarification.
- Dispatch sub-tasks to the appropriate AgentOfX via the harness.

## Position in the Object hierarchy

The Supervisor is the root parent Object: all AgentOfX objects inherit from it
through the prototype chain. Its `self.md` defines the system identity for the
currently running OOC instance.

## Working mode

The Supervisor runs in the main Claude Code session. AgentOfX agents run as
sub-agents dispatched from that session. The Supervisor reviews their output
and commits the final integrated changes.
