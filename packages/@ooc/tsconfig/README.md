# @ooc/tsconfig

Base TypeScript configurations for OOC projects.

## Usage

In an OOC World root `tsconfig.json`:

```json
{
  "extends": "@ooc/tsconfig/world"
}
```

In an individual stone (under `stones/<id>/tsconfig.json`):

```json
{
  "extends": "@ooc/tsconfig/stone"
}
```
