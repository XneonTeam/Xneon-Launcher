# @xnlc/core

XNLC Core is a Minecraft launcher library for version resolution, loader installation, asset management, and game launching.

## Installation

```bash
npm install @xnlc/core
```

## Features

- Launch Minecraft with `vanilla`, `fabric`, `quilt`, `neoforge`, `forge`, `liteloader`, and `optifine`
- Automatically install supported loaders
- Resolve versions and dependencies
- Manage assets and libraries
- Detect and prepare Java automatically
- Support offline and Microsoft authentication

## Usage

```ts
import { Xnlc } from "@xnlc/core";

const xnlc = new Xnlc({
  gameDir: "/path/to/.minecraft",
});

const versions = await xnlc.getOptifineSupportedVersions();

await xnlc.installLoader("1.20.4", "neoforge", "21.0.167");

await xnlc.launch(
  { mcVersion: "1.20.4", loaderType: "neoforge", loaderVersion: "21.0.167" },
  auth,
  { javaPath: "/usr/bin/java", memoryMax: "4G" },
);
```

## License

MIT
