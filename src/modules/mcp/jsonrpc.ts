// mcp/jsonrpc.ts — minimal JSON-RPC 2.0 helpers for the MCP endpoint.
export function ok(id: any, result: any): any {
  return { jsonrpc: "2.0", id, result };
}
export function err(id: any, code: number, message: string): any {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
export function parseBody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
export function statusText(code: number): string {
  const m: Record<number, string> = {
    200: "OK",
    202: "Accepted",
    204: "No Content",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
  };
  return m[code] || "OK";
}
