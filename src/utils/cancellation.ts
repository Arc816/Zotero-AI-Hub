/**
 * Minimal cancellation primitives that work in Zotero's privileged add-on
 * sandbox. Zotero 8 does not expose the browser AbortController constructor to
 * bootstrap scripts, even though TypeScript's DOM declarations make it appear
 * available at build time.
 */
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface CancellationController {
  readonly signal: CancellationSignal;
  abort(): void;
}

class ZoteroCancellationSignal implements CancellationSignal {
  aborted = false;
  private listeners = new Map<() => void, boolean>();

  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void {
    if (type !== "abort") return;
    if (this.aborted) {
      listener();
      return;
    }
    this.listeners.set(listener, !!options?.once);
  }

  removeEventListener(type: "abort", listener: () => void): void {
    if (type === "abort") this.listeners.delete(listener);
  }

  dispatchAbort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const [listener, once] of [...this.listeners]) {
      if (once) this.listeners.delete(listener);
      try {
        listener();
      } catch (error: any) {
        try {
          Zotero.debug("[AIHub] cancellation listener failed: " + (error?.stack || error));
        } catch (_) {}
      }
    }
    this.listeners.clear();
  }
}

export function createCancellationController(): CancellationController {
  const signal = new ZoteroCancellationSignal();
  return {
    signal,
    abort() {
      signal.dispatchAbort();
    },
  };
}
