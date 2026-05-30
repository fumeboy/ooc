// src/executable/prototype/index.ts
export { BUILTIN_PROTO_PREFIX, BUILTIN_BRANCH, builtinProtoId, canonicalObjectId } from "./constants";
export { parseSelfMeta, normalizeExtends, type SelfMeta } from "./self-meta";
export { loadObjectRecord, type ObjectRecord } from "./object-record";
export { buildObjectRegistry, type ObjectRegistry } from "./registry";
export { resolveAlongChain, type Probe } from "./resolve";
