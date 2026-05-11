import {
  createStoneObject,
  mergeData,
  readData,
  readReadme,
  readSelf,
  readServerSource,
  writeReadme,
  writeSelf,
  writeServerSource,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";

function createHttpMethodContext(dir: string) {
  return {
    self: { dir },
    thread: {
      id: "http",
      inject() {
        // HTTP 调用没有线程上下文，这里保留最小空实现。
      },
    },
  } as never;
}

export function createStonesService({ baseDir }: { baseDir: string }) {
  const ref = (objectId: string) => ({ baseDir, objectId });
  const dir = (objectId: string) => `${baseDir}/stones/${objectId}`;

  return {
    async createStone({ objectId }: { objectId: string }) {
      await createStoneObject(ref(objectId));
      return { objectId, dir: dir(objectId), created: true };
    },
    async getStone({ objectId }: { objectId: string }) {
      return { objectId, dir: dir(objectId), exists: true };
    },
    async getSelf({ objectId }: { objectId: string }) {
      return { text: (await readSelf(ref(objectId))) ?? "" };
    },
    async putSelf({ objectId, text }: { objectId: string; text: string }) {
      await writeSelf(ref(objectId), text);
      return { ok: true };
    },
    async getReadme({ objectId }: { objectId: string }) {
      return { text: (await readReadme(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text }: { objectId: string; text: string }) {
      await writeReadme(ref(objectId), text);
      return { ok: true };
    },
    async getData({ objectId }: { objectId: string }) {
      return { data: (await readData(ref(objectId))) ?? {} };
    },
    async patchData({ objectId, patch }: { objectId: string; patch: Record<string, unknown> }) {
      await mergeData(ref(objectId), patch);
      return { ok: true };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      return { code: (await readServerSource(ref(objectId))) ?? "" };
    },
    async putServerSource({ objectId, code }: { objectId: string; code: string }) {
      await writeServerSource(ref(objectId), code);
      return { ok: true };
    },
    async callMethod({ objectId, method, args = {} }: { objectId: string; method: string; args?: Record<string, unknown> }) {
      const methods = await loadUiServerMethods(ref(objectId));
      const entry = methods[method];
      if (!entry) {
        throw new Error(`ui method not found: ${method}`);
      }
      return {
        returnValue: await entry.fn(createHttpMethodContext(dir(objectId)), args),
      };
    },
  };
}
