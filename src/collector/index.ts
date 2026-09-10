import dashboard from "../web/index.html";
import { createServer } from "./server";

createServer({
  hostname: "127.0.0.1",
  port: 4747,
  dashboard: dashboard as any,
});
