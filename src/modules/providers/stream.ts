// providers/stream.ts — the canonical streaming chunk shape.
export interface StreamChunk {
  delta: string;
  done: boolean;
  error?: any;
}
