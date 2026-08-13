// http.ts — streaming SSE + JSON helpers built on Zotero.HTTP.request (XHR).
// Mirrors the pattern used by zotero-ai-butler: manual SSE parsing in
// xmlhttp.onprogress, which is reliable inside the XPCOM sandbox.
import { AIHubError } from "../modules/errors";
import { logWarn } from "./logger";
import { CancellationSignal } from "./cancellation";

export interface SSEEvent {
  event: string;
  data: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  signal?: CancellationSignal;
  providerId?: string;
}

function aborted(providerId?: string): AIHubError {
  return new AIHubError("ABORTED", "已取消。", { providerId });
}

function parseBlock(block: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    else if (line.startsWith(":")) continue; // comment line
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** One-shot JSON request with HTTP-status-aware error mapping. */
export async function requestJSON(url: string, opts: RequestOptions): Promise<any> {
  const holder: { status: number; text: string } = { status: 0, text: "" };
  let res: any;
  let xmlhttp: any = null;
  const abortHandler = () => {
    try { xmlhttp?.abort?.(); } catch (_) {}
  };
  if (opts.signal?.aborted) throw aborted(opts.providerId);
  opts.signal?.addEventListener("abort", abortHandler, { once: true });
  try {
    res = await Zotero.HTTP.request(opts.method || "POST", url, {
      headers: opts.headers,
      body: opts.body,
      responseType: "text",
      timeout: opts.timeout || 60000,
      requestObserver: (requestXMLHttp: any) => {
        xmlhttp = requestXMLHttp;
        if (opts.signal?.aborted) {
          abortHandler();
          return;
        }
        xmlhttp.onloadend = () => {
          holder.status = xmlhttp.status;
          holder.text = xmlhttp.responseText;
        };
      },
    });
    if (!holder.status && res) {
      holder.status = res.status ?? 200;
      holder.text =
        typeof res === "string" ? res : res.responseText || JSON.stringify(res);
    }
  } catch (e: any) {
    if (opts.signal?.aborted) throw aborted(opts.providerId);
    const status = e?.status ?? e?.response?.status ?? holder.status;
    const text = e?.responseText ?? holder.text ?? e?.message ?? "";
    if (status) throw AIHubError.fromHttp(status, opts.providerId, text);
    throw AIHubError.fromException(e, opts.providerId);
  } finally {
    opts.signal?.removeEventListener("abort", abortHandler);
  }
  if (holder.status >= 400) {
    throw AIHubError.fromHttp(holder.status, opts.providerId, holder.text);
  }
  try {
    return JSON.parse(holder.text);
  } catch (e) {
    throw new AIHubError("PARSE", "响应解析失败：" + holder.text.slice(0, 200), {
      providerId: opts.providerId,
    });
  }
}

/** Streaming SSE generator. Yields each `event`/`data` pair as it arrives. */
export async function* streamSSE(
  url: string,
  opts: RequestOptions
): AsyncGenerator<SSEEvent> {
  const queue: SSEEvent[] = [];
  let resolveNext: ((r: IteratorResult<SSEEvent>) => void) | null = null;
  let finished = false;
  let error: any = null;
  let lastLen = 0;
  let sseBuffer = "";
  let fullText = "";
  let yielded = 0;
  let xmlhttp: any = null;
  let abortHandler: (() => void) | null = null;

  const push = (ev: SSEEvent) => {
    yielded++;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: ev, done: false });
    } else queue.push(ev);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as any, done: true });
    }
  };
  const fail = (e: any) => {
    if (finished) return;
    error = e;
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as any, done: true });
    }
  };

  const pump = (xmlhttp: any) => {
    if (finished || opts.signal?.aborted) return;
    const full = xmlhttp.responseText || "";
    if (full.length <= lastLen) return;
    const slice = full.slice(lastLen);
    lastLen = full.length;
    fullText += slice;
    sseBuffer += slice;
    let match: RegExpMatchArray | null;
    while ((match = sseBuffer.match(/\r?\n\r?\n/))) {
      const idx = match.index || 0;
      const block = sseBuffer.slice(0, idx).replace(/\r\n/g, "\n");
      sseBuffer = sseBuffer.slice(idx + match[0].length);
      const ev = parseBlock(block);
      if (ev?.data === "[DONE]") {
        finish();
        try { xmlhttp?.abort?.(); } catch (_) {}
        return;
      }
      if (ev) push(ev);
    }
  };

  if (opts.signal?.aborted) throw aborted(opts.providerId);
  abortHandler = () => {
    try { xmlhttp?.abort?.(); } catch (_) {}
    fail(aborted(opts.providerId));
  };
  opts.signal?.addEventListener("abort", abortHandler, { once: true });

  const request = Zotero.HTTP.request(opts.method || "POST", url, {
    headers: opts.headers,
    body: opts.body,
    responseType: "text",
    timeout: opts.timeout || 120000,
    requestObserver: (requestXMLHttp: any) => {
      xmlhttp = requestXMLHttp;
      if (opts.signal?.aborted) {
        abortHandler?.();
        return;
      }
      xmlhttp.onprogress = () => pump(xmlhttp);
      xmlhttp.onload = () => {
        pump(xmlhttp);
        finish();
      };
      xmlhttp.onerror = () =>
        fail(
          AIHubError.fromException(
            new Error(xmlhttp.statusText || "network error"),
            opts.providerId
          )
        );
      xmlhttp.onabort = () => fail(aborted(opts.providerId));
      xmlhttp.ontimeout = () => fail(new AIHubError("TIMEOUT", "请求超时，请稍后重试。", { providerId: opts.providerId }));
    },
  });
  request.catch((e: any) => {
    if (opts.signal?.aborted) fail(aborted(opts.providerId));
    else fail(AIHubError.fromException(e, opts.providerId));
  });

  try {
    while (true) {
      if (opts.signal?.aborted) throw aborted(opts.providerId);
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (error) throw error;
      if (finished) {
        // No SSE events arrived: the response may be a plain JSON error body.
        if (yielded === 0 && fullText.trim()) {
          const j = safeJson(fullText);
          if (j?.error) {
            const status = typeof j.error === "object" ? j.error.status || 400 : 400;
            const msg =
              typeof j.error === "object" ? j.error.message || JSON.stringify(j.error) : String(j.error);
            throw AIHubError.fromHttp(status, opts.providerId, msg);
          }
        }
        return;
      }
      await new Promise<IteratorResult<SSEEvent>>((res) => {
        resolveNext = res;
      });
    }
  } finally {
    if (abortHandler) opts.signal?.removeEventListener("abort", abortHandler);
    if (!finished) {
      try { xmlhttp?.abort?.(); } catch (_) {}
    }
  }
}

/** Streaming NDJSON generator (newline-delimited JSON; used by Ollama). */
export async function* streamLines(
  url: string,
  opts: RequestOptions
): AsyncGenerator<string> {
  const queue: string[] = [];
  let resolveNext: ((r: IteratorResult<string>) => void) | null = null;
  let finished = false;
  let error: any = null;
  let lastLen = 0;
  let lineBuffer = "";
  let xmlhttp: any = null;
  let abortHandler: (() => void) | null = null;

  const push = (line: string) => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: line, done: false });
    } else queue.push(line);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as any, done: true });
    }
  };
  const fail = (e: any) => {
    if (finished) return;
    error = e;
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as any, done: true });
    }
  };

  const pump = (xmlhttp: any) => {
    if (finished || opts.signal?.aborted) return;
    const full = xmlhttp.responseText || "";
    if (full.length <= lastLen) return;
    lineBuffer += full.slice(lastLen);
    lastLen = full.length;
    let nl: number;
    while ((nl = lineBuffer.indexOf("\n")) >= 0) {
      const line = lineBuffer.slice(0, nl).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(nl + 1);
      if (line.trim()) push(line);
    }
  };

  if (opts.signal?.aborted) throw aborted(opts.providerId);
  abortHandler = () => {
    try { xmlhttp?.abort?.(); } catch (_) {}
    fail(aborted(opts.providerId));
  };
  opts.signal?.addEventListener("abort", abortHandler, { once: true });

  const request = Zotero.HTTP.request(opts.method || "POST", url, {
    headers: opts.headers,
    body: opts.body,
    responseType: "text",
    timeout: opts.timeout || 120000,
    requestObserver: (requestXMLHttp: any) => {
      xmlhttp = requestXMLHttp;
      if (opts.signal?.aborted) {
        abortHandler?.();
        return;
      }
      xmlhttp.onprogress = () => pump(xmlhttp);
      xmlhttp.onload = () => {
        pump(xmlhttp);
        finish();
      };
      xmlhttp.onerror = () =>
        fail(AIHubError.fromException(new Error(xmlhttp.statusText || "network error"), opts.providerId));
      xmlhttp.onabort = () => fail(aborted(opts.providerId));
      xmlhttp.ontimeout = () => fail(new AIHubError("TIMEOUT", "请求超时，请稍后重试。", { providerId: opts.providerId }));
    },
  });
  request.catch((e: any) => {
    if (opts.signal?.aborted) fail(aborted(opts.providerId));
    else fail(AIHubError.fromException(e, opts.providerId));
  });

  try {
    while (true) {
      if (opts.signal?.aborted) throw aborted(opts.providerId);
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (error) throw error;
      if (finished) return;
      await new Promise<IteratorResult<string>>((res) => {
        resolveNext = res;
      });
    }
  } finally {
    if (abortHandler) opts.signal?.removeEventListener("abort", abortHandler);
    if (!finished) {
      try { xmlhttp?.abort?.(); } catch (_) {}
    }
  }
}

export function safeJson(data: string): any {
  try {
    return JSON.parse(data);
  } catch (e) {
    logWarn("safeJson parse fail", data.slice(0, 120));
    return null;
  }
}
