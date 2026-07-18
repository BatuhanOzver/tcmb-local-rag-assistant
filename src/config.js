// Application configuration – all paths relative to project root
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const config = {
  // Model
  model: "phi-3.5-mini",

  // Force a specific device for the model variant: "CPU" | "GPU" | "NPU" | null (auto-select)
  // NOTE: This machine's CPU inference path was consistently hitting a hard
  // OperationCanceledException partway through generation, regardless of
  // maxTokens (confirmed via manual `foundry run` tests: CPU cancels, GPU
  // completes a full response without issue). So instead of forcing CPU, we
  // let the SDK auto-select (GPU > NPU > CPU) here. If you later see
  // out-of-memory errors on GPU during long responses (possible on very
  // low-VRAM GPUs), switch this back to "CPU" and lower maxTokens instead.
  preferredDevice: null,

  // RAG
  docsDir: path.join(ROOT, "docs"),
  dbPath: path.join(ROOT, "data", "rag.db"),
  chunkSize: 200,        // restored to full size (was temporarily 100 for a quick test)
  chunkOverlap: 25,      // tokens overlap between chunks
  topK: 3,               // restored to full value (was temporarily 1 for a quick test)

  // Generation
  maxTokens: 512,         // can afford more headroom now with the smaller/faster model
  maxTokensCompact: 256,

  // Server
  port: 3000,
  host: "127.0.0.1",

  // UI
  publicDir: path.join(ROOT, "public"),
};
