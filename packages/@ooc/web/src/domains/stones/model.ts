export type Stone = {
  objectId: string;
  dir: string;
};

export type CreateStoneInput = {
  name: string;
  description?: string;
  self?: string;
  readable?: string;
};

export type KnowledgeEntryInput = {
  objectId: string;
  path: string;
  content?: string;
};
