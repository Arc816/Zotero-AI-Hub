// mcp/server.ts — embedded Streamable HTTP MCP server over nsIServerSocket.
import { getPref } from "../config";
import { ok, err, parseBody, statusText } from "./jsonrpc";
import { toolsList, handleToolCall } from "./tools";
import { logWarn } from "../../utils/logger";

let serverSocket: any = null;
let listenPort = 0;

export function startMcp(): void {
  if (serverSocket) return;
  listenPort = parseInt(getPref("mcp.port")) || 23121;
  const loopbackOnly = getPref("mcp.allowRemote") !== true;
  try {
    serverSocket = Components.classes["@mozilla.org/network/server-socket;1"].createInstance(
      Components.interfaces.nsIServerSocket
    );
    serverSocket.init(listenPort, loopbackOnly, -1);
    serverSocket.asyncListen({
      onSocketAccepted: (_socket: any, transport: any) => handleConnection(transport),
      onStopListening: () => {},
    });
    Zotero.debug(`[AIHub] MCP server listening on 127.0.0.1:${listenPort}`);
  } catch (e: any) {
    logWarn("startMcp failed", e);
    serverSocket = null;
  }
}

export function stopMcp(): void {
  if (serverSocket) {
    try {
      serverSocket.close();
    } catch {
      /* ignore */
    }
    serverSocket = null;
  }
}

export function mcpStatus(): string {
  return serverSocket ? `运行中：http://127.0.0.1:${listenPort}/mcp` : "已停止";
}

function extractHeader(headers: string, name: string): string | null {
  const m = headers.match(new RegExp(`${name}:\\s*([^\\r\\n]+)`, "i"));
  return m ? m[1].trim() : null;
}

function handleConnection(transport: any): void {
  try {
    const instream = transport.openInputStream(0, 0, 0);
    const sin = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(
      Components.interfaces.nsIScriptableInputStream
    );
    sin.init(instream);
    let buf = "";
    const pump = () => {
      try {
        while (sin.available()) buf += sin.read(sin.available());
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) return schedule();
        const headerStr = buf.slice(0, headerEnd);
        const clMatch = headerStr.match(/Content-Length:\s*(\d+)/i);
        const cl = clMatch ? parseInt(clMatch[1]) : 0;
        let body = buf.slice(headerEnd + 4);
        if (body.length < cl) return schedule();
        const reqLine = headerStr.split("\r\n")[0];
        const parts = reqLine.split(" ");
        const method = parts[0];
        const path = parts[1];
        respond(transport, method, path, body, headerStr);
      } catch (e) {
        logWarn("mcp pump", e);
        try {
          transport.close();
        } catch {
          /* ignore */
        }
      }
    };
    const schedule = () => setTimeout(pump, 12);
    pump();
  } catch (e) {
    logWarn("mcp handleConnection", e);
  }
}

function respond(transport: any, method: string, path: string, body: string, headerStr: string): void {
  const sessionId = extractHeader(headerStr, "Mcp-Session-Id");
  if (method === "OPTIONS") {
    writeResponse(transport, 204, "", sessionId);
    return;
  }
  if (path === "/mcp" && method === "GET") {
    writeResponse(transport, 405, "Use POST for JSON-RPC.", sessionId);
    return;
  }
  if (path === "/mcp" && method === "POST") {
    handleMCPRequest(body, sessionId).then((r) => {
      writeResponse(transport, r.status, JSON.stringify(r.body), r.sessionId);
    });
    return;
  }
  writeResponse(transport, 404, "Not Found", sessionId);
}

async function handleMCPRequest(
  body: string,
  sessionIdIn: string | null
): Promise<{ status: number; body: any; sessionId: string | null }> {
  const req = parseBody(body);
  if (!req) return { status: 400, body: err(null, -32700, "Parse error"), sessionId: sessionIdIn };
  if (Array.isArray(req)) {
    const results: any[] = [];
    for (const r of req) results.push(await handleOne(r, sessionIdIn));
    return { status: 200, body: results, sessionId: results[0]?.sessionId || sessionIdIn };
  }
  return await handleOne(req, sessionIdIn);
}

async function handleOne(
  req: any,
  sessionId: string | null
): Promise<{ status: number; body: any; sessionId: string | null }> {
  const id = req.id;
  const method = req.method;
  if (method === "initialize") {
    const sid = sessionId || "sess-" + Math.random().toString(36).slice(2);
    return {
      status: 200,
      sessionId: sid,
      body: ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "zotero-ai-hub", version: "1.4.5" },
      }),
    };
  }
  if (method === "ping") return { status: 200, sessionId, body: ok(id, {}) };
  if (method === "notifications/initialized") return { status: 202, sessionId, body: null };
  if (method === "tools/list") return { status: 200, sessionId, body: ok(id, { tools: toolsList() }) };
  if (method === "tools/call") {
    const res = await handleToolCall(req.params?.name, req.params?.arguments || {});
    return { status: 200, sessionId, body: ok(id, res) };
  }
  return { status: 200, sessionId, body: err(id, -32601, "Method not found: " + method) };
}

function writeResponse(transport: any, status: number, body: string, sessionId: string | null): void {
  try {
    const out = transport.openOutputStream(0, 0, 0);
    const headers = [
      `HTTP/1.1 ${status} ${statusText(status)}`,
      "Content-Type: application/json; charset=utf-8",
      "Content-Length: " + body.length,
      "Access-Control-Allow-Origin: *",
      "Access-Control-Allow-Headers: *",
      "Access-Control-Allow-Methods: POST, GET, OPTIONS",
    ];
    if (sessionId) headers.push("Mcp-Session-Id: " + sessionId);
    const data = headers.join("\r\n") + "\r\n\r\n" + body;
    out.write(data, data.length);
    out.close();
  } catch (e) {
    logWarn("mcp writeResponse", e);
  } finally {
    try {
      transport.close();
    } catch {
      /* ignore */
    }
  }
}
