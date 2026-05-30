/** ooc-3 adaptation: Stone uses objectId (name) for routing compat with ooc-2. */
export type Stone = {
  objectId: string;
  dir: string;
};

export type CreateStoneInput = {
  name: string;
  description?: string;
  self?: string;
  readme?: string;
};

export type KnowledgeEntryInput = {
  objectId: string;
  path: string;
  content?: string;
};
