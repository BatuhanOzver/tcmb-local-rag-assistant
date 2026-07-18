/**
 * Foundry Local chat engine.
 * Uses the Foundry Local SDK to discover, load, and run inference
 * on a local model. Performs RAG retrieval and generates responses.
 * Selects the hardware-optimised model variant automatically and
 * reports download/load progress via a status callback.
 */
import { FoundryLocalManager } from "foundry-local-sdk";
import { VectorStore } from "./vectorStore.js";
import { config } from "./config.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT } from "./prompts.js";

// The exact refusal phrase the model is instructed to use when the
// retrieved context does not answer the question. Small local models
// sometimes keep talking after saying this (adding disclaimers, English
// text, etc). We hard-truncate the response right after this phrase so
// the user never sees that extra, unreliable text.
const REFUSAL_PHRASE = "Bu bilgi yerel bilgi tabanında mevcut değil.";

// Markers that indicate the model has stopped giving a real answer and has
// started leaking raw retrieved context, or drifting into unreliable
// rambling (e.g. English disclaimers). If any of these appear, we cut the
// response BEFORE the marker (the marker itself is discarded).
const LEAK_MARKERS = [
  "--- Document",
  "\n---\n",
  "As a language model",
  "language model AI",
  "I don't have real-time access",
  "(Note:",
  "\nNote:",
];

/**
 * Sanitize a full (non-streamed) model response:
 * 1. If the refusal phrase is present, keep everything up to and including
 *    it, and discard anything the model rambled on with afterwards.
 * 2. Otherwise, if a "leak marker" is present (raw context leaking into the
 *    answer, or an off-topic disclaimer), cut everything from that marker
 *    onwards.
 * 3. Finally, once the first complete "Referans:" line is found (the last
 *    section in our required response format), cut everything after it.
 *    Small models sometimes loop back and start repeating/duplicating the
 *    answer after this point instead of stopping.
 */
const REFERANS_PATTERN = /(\*\*Referans\*\*|Referans)\s*:/i;

function sanitizeResponse(text) {
  const refusalIdx = text.indexOf(REFUSAL_PHRASE);
  if (refusalIdx !== -1) {
    return text.slice(0, refusalIdx + REFUSAL_PHRASE.length);
  }

  let cutIdx = -1;
  for (const marker of LEAK_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (cutIdx === -1 || idx < cutIdx)) cutIdx = idx;
  }
  let result = cutIdx !== -1 ? text.slice(0, cutIdx).trimEnd() : text;

  const refMatch = result.match(REFERANS_PATTERN);
  if (refMatch) {
    const newlineIdx = result.indexOf("\n", refMatch.index);
    if (newlineIdx !== -1) {
      result = result.slice(0, newlineIdx).trimEnd();
    }
    // If there's no newline yet, the Referans line is already the last
    // thing in the text — nothing to cut.
  }

  // Safety net: strip any internal "Document N:" labels that the model may
  // have leaked into the visible text (e.g. inside the Referans line),
  // even though the prompt instructs it not to. These labels come from our
  // own context-building format and should never be user-visible.
  result = result.replace(/Document\s+\d+\s*:\s*/gi, "");

  return result;
}

export class ChatEngine {
  constructor() {
    this.chatClient = null;
    this.model = null;
    this.store = null;
    this.compactMode = false;
    this.modelAlias = null;
    /** @type {(status: {phase: string, message: string, progress?: number}) => void} */
    this._statusCallback = null;
  }

  /** Register a callback that receives init status updates for the UI. */
  onStatus(callback) {
    this._statusCallback = callback;
  }

  _emitStatus(phase, message, progress) {
    const status = { phase, message, ...(progress !== undefined && { progress }) };
    console.log(`[ChatEngine] ${message}`);
    if (this._statusCallback) this._statusCallback(status);
  }

  /**
   * Initialize the engine: create Foundry Local manager, discover and load
   * the best model variant for this hardware, and open the vector store.
   */
  async init() {
    this._emitStatus("init", "Initializing Foundry Local SDK...");

    // Create the manager (requires appName)
    const manager = FoundryLocalManager.create({ appName: "gas-field-local-rag" });
    const catalog = manager.catalog;

    this._emitStatus("catalog", "Discovering available models...");
    this.model = await catalog.getModel(config.model);
    this.modelAlias = this.model.alias;

    // Log every variant available for this model/hardware so we can see
    // what devices (CPU/GPU/NPU) are actually on offer, not just the auto-picked one.
    // Note: modelInfo.device is not reliably populated by the native SDK, so we
    // detect the device from the variant id itself (e.g. "...-generic-cpu:2").
    const DEVICE_ID_PATTERNS = { CPU: /-cpu(?::|$)/i, GPU: /-gpu(?::|$)/i, NPU: /-npu(?::|$)/i };
    const deviceFromId = (id) => {
      for (const [device, pattern] of Object.entries(DEVICE_ID_PATTERNS)) {
        if (pattern.test(id)) return device;
      }
      return "unknown";
    };

    console.log(`[ChatEngine] ${this.model.variants.length} variant(s) found for '${this.modelAlias}':`);
    for (const v of this.model.variants) {
      console.log(
        `[ChatEngine]   - id=${v.id} device=${deviceFromId(v.id)} cached=${v.isCached}`
      );
    }

    // Force a specific device if configured (see config.js for why).
    if (config.preferredDevice) {
      const preferred = this.model.variants.find(
        (v) => deviceFromId(v.id) === config.preferredDevice
      );
      if (preferred) {
        this.model.selectVariant(preferred.id);
        this._emitStatus(
          "variant",
          `Forcing device=${config.preferredDevice}: ${preferred.id}`
        );
      } else {
        this._emitStatus(
          "variant",
          `No ${config.preferredDevice} variant available for ${this.modelAlias}; falling back to auto-selected ${this.model.id}`
        );
      }
    }

    // The SDK auto-selects the best variant for this hardware (GPU > NPU > CPU)
    // unless overridden above.
    this._emitStatus("variant", `Selected model: ${this.model.id}`);

    // Download the model if not already cached, with progress reporting
    if (!this.model.isCached) {
      this._emitStatus("download", `Downloading ${this.modelAlias}... This may take a few minutes on first run.`, 0);
      await this.model.download((progress) => {
        const pct = Math.round(progress * 100);
        this._emitStatus("download", `Downloading ${this.modelAlias}... ${pct}%`, progress);
      });
      this._emitStatus("download", `Download complete.`, 1);
    } else {
      this._emitStatus("cached", `Model ${this.modelAlias} is already cached.`);
    }

    // Load the model into memory
    this._emitStatus("loading", `Loading ${this.modelAlias} into memory...`);
    await this.model.load();

    // Create the native chat client with performance settings pre-configured
    this.chatClient = this.model.createChatClient();
    this.chatClient.settings.temperature = 0.1; // Low for deterministic, safety-critical responses
    this._emitStatus("ready", `Model ready: ${this.modelAlias}`);

    // Open the local vector store
    this.store = new VectorStore(config.dbPath);
    const count = this.store.count();
    this._emitStatus("ready", `Vector store ready: ${count} chunks indexed.`);

    if (count === 0) {
      console.warn("[ChatEngine] WARNING: No documents ingested. Run 'npm run ingest' first.");
    }
  }

  /** Expose the vector store for direct operations (e.g. upload ingestion). */
  getStore() {
    return this.store;
  }

  /**
   * Set compact mode for extreme latency / edge devices.
   */
  setCompactMode(enabled) {
    this.compactMode = enabled;
    console.log(`[ChatEngine] Compact mode: ${enabled ? "ON" : "OFF"}`);
  }

  /**
   * Retrieve relevant context from the local knowledge base.
   */
  retrieve(query) {
    const topK = this.compactMode ? Math.min(config.topK, 3) : config.topK;
    return this.store.search(query, topK);
  }

  /**
   * Format retrieved chunks into a context block for the prompt.
   */
  _buildContext(chunks) {
    if (chunks.length === 0) {
      return "No relevant documents found in local knowledge base.";
    }

    return chunks
      .map(
        (c, i) =>
          `--- Document ${i + 1}: ${c.title} [${c.category}] ---\n${c.content}`
      )
      .join("\n\n");
  }

  /**
   * Generate a response for a user query (non-streaming).
   */
  async query(userMessage, history = []) {
    // 1. Retrieve relevant chunks
    const chunks = this.retrieve(userMessage);
    const context = this._buildContext(chunks);

    // 2. Build messages array
    const systemPrompt = this.compactMode ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT;
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `Retrieved context from local knowledge base:\n\n${context}`,
      },
      ...history,
      { role: "user", content: userMessage },
    ];

    // 3. Call the local model via the native chat client
    this.chatClient.settings.maxTokens = this.compactMode
      ? config.maxTokensCompact
      : config.maxTokens;
    let response;
    try {
      response = await this.chatClient.completeChat(messages);
    } catch (err) {
      console.error("[ChatEngine] Model completion failed:", err.message || err);
      return {
        text: "Model ile iletişimde bir hata oluştu. Lütfen tekrar deneyin.",
        sources: [],
      };
    }

    // 4. Hard-truncate anything the model says after the refusal phrase,
    //    or after any raw-context leak / off-topic rambling, so unreliable
    //    text never reaches the user.
    const text = sanitizeResponse(response.choices[0].message.content);

    return {
      text,
      sources: chunks.map((c) => ({
        title: c.title,
        category: c.category,
        docId: c.doc_id,
        score: Math.round(c.score * 100) / 100,
      })),
    };
  }

  /**
   * Generate a streaming response for a user query.
   * Returns an async iterable of text chunks.
   */
  async *queryStream(userMessage, history = []) {
    // 1. Retrieve relevant chunks
    const chunks = this.retrieve(userMessage);
    const context = this._buildContext(chunks);

    // 2. Build messages array
    const systemPrompt = this.compactMode ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT;
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `Retrieved context from local knowledge base:\n\n${context}`,
      },
      ...history,
      { role: "user", content: userMessage },
    ];

    // 3. Stream from the local model via the SDK's callback-based streaming
    this.chatClient.settings.maxTokens = this.compactMode
      ? config.maxTokensCompact
      : config.maxTokens;

    // Buffer chunks from the callback and yield them as an async iterable
    const textChunks = [];
    let resolve;
    let done = false;
    let streamError = null;

    const streamPromise = this.chatClient.completeStreamingChat(messages, (chunk) => {
      textChunks.push(chunk);
      if (resolve) { resolve(); resolve = null; }
    }).then(() => {
      done = true;
      if (resolve) { resolve(); resolve = null; }
    }).catch((err) => {
      // IMPORTANT: catching here prevents an unhandled promise rejection,
      // which would otherwise crash the entire Node process (and take down
      // the whole server) if the native model call fails or is cancelled
      // (e.g. on slower/older hardware running out of time on a long
      // generation). Instead we surface it as a normal error chunk below.
      console.error("[ChatEngine] Streaming completion failed:", err.message || err);
      streamError = err;
      done = true;
      if (resolve) { resolve(); resolve = null; }
    });

    // Yield sources metadata first
    yield {
      type: "sources",
      data: chunks.map((c) => ({
        title: c.title,
        category: c.category,
        docId: c.doc_id,
        score: Math.round(c.score * 100) / 100,
      })),
    };

    // Yield text chunks from the SDK streaming callback buffer, but stop
    // immediately (without waiting for/yielding further chunks) once the
    // accumulated text contains the refusal phrase, or a "leak marker"
    // (raw context / off-topic rambling). This prevents unreliable text
    // from reaching the user.
    let accumulated = "";
    let stopped = false;

    while (!stopped && (!done || textChunks.length > 0)) {
      if (textChunks.length === 0 && !done) {
        await new Promise((r) => { resolve = r; });
      }
      while (textChunks.length > 0) {
        const chunk = textChunks.shift();
        const content = chunk.choices?.[0]?.delta?.content;
        if (!content) continue;

        const beforeLen = accumulated.length;
        accumulated += content;

        // Case 1: refusal phrase — keep everything up to and including it.
        const refusalIdx = accumulated.indexOf(REFUSAL_PHRASE);
        if (refusalIdx !== -1) {
          const cutoffInAccumulated = refusalIdx + REFUSAL_PHRASE.length;
          const contentToYield = accumulated.slice(beforeLen, cutoffInAccumulated);
          if (contentToYield) {
            yield { type: "text", data: contentToYield };
          }
          stopped = true;
          break;
        }

        // Case 2: a leak marker — keep everything before it, discard the rest.
        let markerIdx = -1;
        for (const marker of LEAK_MARKERS) {
          const idx = accumulated.indexOf(marker);
          if (idx !== -1 && (markerIdx === -1 || idx < markerIdx)) markerIdx = idx;
        }
        if (markerIdx !== -1) {
          const contentToYield = accumulated.slice(beforeLen, markerIdx);
          if (contentToYield) {
            yield { type: "text", data: contentToYield };
          }
          stopped = true;
          break;
        }

        // Case 3: the first complete "Referans:" line has just finished
        // (a newline arrived after it). This is the natural end of a
        // well-formed answer — small models sometimes loop back and start
        // repeating/duplicating the answer if allowed to continue past
        // this point, so we stop here.
        const refMatch = accumulated.match(REFERANS_PATTERN);
        if (refMatch) {
          const newlineIdx = accumulated.indexOf("\n", refMatch.index);
          if (newlineIdx !== -1 && newlineIdx >= beforeLen) {
            let contentToYield = accumulated.slice(beforeLen, newlineIdx);
            // Safety net: strip any leaked internal "Document N:" labels
            // from the tail of the response (these should never be
            // user-visible; they're an artefact of our context format).
            contentToYield = contentToYield.replace(/Document\s+\d+\s*:\s*/gi, "");
            if (contentToYield) {
              yield { type: "text", data: contentToYield };
            }
            stopped = true;
            break;
          }
        }

        yield { type: "text", data: content };
      }
    }

    // If the model call failed/was cancelled partway through, tell the
    // client explicitly (rather than silently ending the stream).
    if (streamError && accumulated.length === 0) {
      yield {
        type: "error",
        data: "Model uzun bir cevap üretmeye çalışırken zaman aşımına uğradı. Lütfen tekrar deneyin veya Edge Mode'u açarak daha kısa cevaplar isteyin.",
      };
    } else if (streamError) {
      // We already streamed some partial text before the failure. Rather than
      // silently cutting the answer off, append a short visible notice so the
      // user knows the response may be incomplete instead of assuming it's a
      // formatting bug.
      yield {
        type: "text",
        data: "\n\n⚠️ *Cevap tamamlanamadan kesildi (donanım zaman aşımı). Edge Mode'u açıp tekrar deneyebilirsiniz.*",
      };
    }

    // Let the underlying stream finish in the background; we don't need to
    // await it before returning if we've already cut the response short.
    // (streamPromise never rejects now since we added .catch() above.)
    if (!stopped) {
      await streamPromise;
    }
  }

  close() {
    if (this.model) {
      this.model.unload().catch(() => {});
    }
    if (this.store) this.store.close();
  }
}
