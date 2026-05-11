import { t } from "elysia";

export const objectIdParams = t.Object({ objectId: t.String() });
export const textBody = t.Object({ text: t.String() });
export const codeBody = t.Object({ code: t.String() });
export const patchDataBody = t.Object({ patch: t.Record(t.String(), t.Any()) });
export const callMethodBody = t.Object({
  method: t.String(),
  args: t.Optional(t.Record(t.String(), t.Any())),
});
