# root prototype (外部说明)

OOC-3 的"出厂 Object 根原型"。所有 OOC Object 默认 `extends: root`，继承 root 暴露的 13 个 public method 与 defaultContext 切片组装。

子原型（program / search / file / knowledge / command_exec / skill_index / custom）通过 `extends: root` 继承；如需特化某方法，在自身 server/index.ts override 即可。

详见 root.self.md。
