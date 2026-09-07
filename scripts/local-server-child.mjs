// A lost supervisor must not leave an orphan serving the same data after the next logon restart.
import { fileURLToPath } from "node:url";
if (!process.send) throw new Error("请通过本地服务守护程序启动此入口。");
process.once("disconnect", () => process.exit(1));
// Preserve server.js's normal direct-execution startup (listen + arXiv scheduler).
process.argv[1] = fileURLToPath(new URL("../server.js", import.meta.url));
await import("../server.js");
