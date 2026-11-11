import { createServer } from "node:http";
import { HealthPayload, PROTOCOL_VERSION, ResponseEnvelope } from "@secure-transfer/shared";

const port = Number(process.env.PORT ?? 3000);
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "GET" && request.url === "/api/health") {
    const result: ResponseEnvelope<HealthPayload> = {
      version: PROTOCOL_VERSION,
      type: "response",
      id: "health",
      ok: true,
      payload: { status: "ok", service: "secure-transfer-server" },
    };
    response.writeHead(200).end(JSON.stringify(result));
    return;
  }

  const result: ResponseEnvelope = {
    version: PROTOCOL_VERSION,
    type: "response",
    id: "unknown",
    ok: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  };
  response.writeHead(404).end(JSON.stringify(result));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SecureTransfer API listening at http://127.0.0.1:${port}`);
});
