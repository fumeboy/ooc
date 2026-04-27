import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadTrait } from "../../extendable/trait/loader.js";

/** Trait 信息（前端展示用） */
interface TraitInfo {
  name: string;
  readme: string;
  hasMethods: boolean;
  methods: { name: string; description: string }[];
}

/**
 * 获取对象的 traits 详情（对象自身 + kernel）
 *
 * 本函数仅扫 traits/ 一级子目录（不递归），用于前端对象详情页的 trait 列表展示。
 */
export async function getTraitsInfo(
  objectDir: string,
  worldRootDir: string,
): Promise<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] }> {
  const objectTraitsDir = join(objectDir, "traits");
  const kernelTraitsDir = join(worldRootDir, "kernel", "traits");

  const loadTraitInfos = async (
    dir: string,
    expectedNamespace: "self" | "kernel",
  ): Promise<TraitInfo[]> => {
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const infos: TraitInfo[] = [];
    for (const name of names) {
      const trait = await loadTrait(join(dir, name), expectedNamespace);
      if (trait) {
        const methods = [
          ...Object.entries(trait.llmMethods ?? {}).map(([methodName, method]) => ({
            name: methodName,
            description: method.description,
          })),
          ...Object.entries(trait.uiMethods ?? {}).map(([methodName, method]) => ({
            name: methodName,
            description: method.description,
          })),
        ];
        infos.push({
          name: `${trait.namespace}:${trait.name}`,
          readme: trait.readme,
          hasMethods: methods.length > 0,
          methods,
        });
      }
    }
    return infos;
  };

  return {
    traits: await loadTraitInfos(objectTraitsDir, "self"),
    kernelTraits: await loadTraitInfos(kernelTraitsDir, "kernel"),
  };
}
