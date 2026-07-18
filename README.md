[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933?logo=node.js&logoColor=fff)](https://nodejs.org/)
[![Foundry Local](https://img.shields.io/badge/Foundry%20Local-On--Device%20AI-0078D4?logo=microsoft&logoColor=fff)](https://foundrylocal.ai)
[![Phi-3.5 Mini](https://img.shields.io/badge/Model-Phi--3.5%20Mini%20Instruct-6B21A8)](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Offline](https://img.shields.io/badge/Connectivity-100%25%20Offline-brightgreen)]()

# TCMB Local RAG – Offline Central Bank of Turkey Policy Assistant

A fully offline, on-device **Retrieval-Augmented Generation (RAG)** assistant that answers questions about the mandate, monetary policy tools, decision-making process, and monetary policy history (2001–2026) of the **Central Bank of the Republic of Turkey (TCMB / CBRT)**. Built with **[Foundry Local](https://foundrylocal.ai)** and **Phi-3.5 Mini Instruct**, this project runs entirely on-device: no cloud, no API keys, no internet connection required.

This project was built during a summer software engineering internship (Microsoft Türkiye AI Innovator Program) as an adaptation of Microsoft's [official Foundry Local RAG sample](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-your-first-local-rag-application-with-foundry-local/4501968), rebuilt around a custom knowledge base and hardened against several real-world reliability issues (see [Challenges & Solutions](#challenges--solutions-what-i-learned) below).

> **New to RAG?** Retrieval-Augmented Generation is a pattern where an AI model's answers are grounded in a specific set of documents. Instead of relying solely on what the model learned during training, RAG retrieves relevant chunks from your own documents and feeds them to the model as context. This dramatically reduces hallucination and makes the AI useful for domain-specific tasks.

## What You'll Learn

If you're a developer getting started with AI-powered applications, this project demonstrates:

1. **How RAG works end-to-end** – document ingestion, chunking, vector storage, retrieval, and generation
2. **Running AI models locally** with [Foundry Local](https://foundrylocal.ai) (CPU, GPU, or NPU)
3. **TF-IDF vector search** with SQLite: no external vector database or embedding model needed
4. **Streaming AI responses** using Server-Sent Events (SSE)
5. **Hardening a local LLM app** against hallucination, context leakage, malformed output, and hardware-related crashes

## Architecture

**How a query flows:**

1. The user types a question in the browser
2. The Express server receives it and searches the SQLite vector store for the most relevant document chunks (TF-IDF cosine similarity)
3. Those chunks are injected into the prompt as context
4. Foundry Local generates a response using Phi-3.5 Mini, grounded strictly in the retrieved context
5. The response is sanitized (see below) and streams back to the browser via SSE

## Features

- **100% offline** – no internet, no cloud, no outbound calls
- **Strict grounding** – the model is instructed (and code-enforced) to never state a figure, rate, or date that isn't present in the retrieved context
- **Response sanitization** – server-side safeguards strip leaked raw context, off-topic disclaimers, and repeated/looping output before it ever reaches the user (see Challenges & Solutions)
- **Crash-resilient** – model/hardware errors are caught and surfaced gracefully instead of taking down the server
- **Streaming responses** – real-time SSE streaming to the UI
- **Mobile responsive** – works on phones, tablets, and desktops
- **Edge/compact mode** – toggle for shorter, lower-latency responses on constrained hardware
- **Document upload** – add new `.md`/`.txt` documents from the UI at runtime
- **Source citations** – every answer shows which documents (and relevance scores) it was grounded in

## Prerequisites

Before you begin, make sure you have:

- **Node.js** ≥ 20: [Download here](https://nodejs.org/)
- **Foundry Local**: Microsoft's on-device AI runtime
  ```
  winget install Microsoft.FoundryLocal
  ```
- The **phi-3.5-mini** model (auto-downloaded on first run via the SDK, approximately 2 GB)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/BatuhanOzver/tcmb-local-rag-assistant.git
cd tcmb-local-rag-assistant

# 2. Install dependencies
npm install

# 3. Ingest the TCMB knowledge base documents into the local vector store
npm run ingest

# 4. Start the server (starts Foundry Local automatically)
npm start
```

Open **http://127.0.0.1:3000** in a browser. You should see the landing page with quick-action buttons and the chat input.

### What Happens at Startup

1. **`npm run ingest`** reads every `.md` file in `docs/`, splits them into overlapping chunks, computes TF-IDF vectors, and stores everything in `data/rag.db` (SQLite).
2. **`npm start`** uses the Foundry Local SDK to discover and load the Phi-3.5 Mini model from the local catalog (GPU preferred, falls back to CPU/NPU), opens the vector store, and starts the Express server on port 3000.

## Chatting with the Agent

Type a question or tap one of the quick-action buttons (TCMB Görevleri, Enflasyon Hedeflemesi, PPK Karar Süreci, Para Politikası Araçları, Faiz Koridoru, 2018 Kur Şoku, Güncel Politika Faizi, EVDS). The agent retrieves relevant document chunks and generates a structured, source-cited response:

```
Özet: TCMB'nin temel görevi fiyat istikrarını sağlamaktır.

Önemli Noktalar:
- Para politikası araçlarını kullanır.
- Bağımsız karar alma yetkisine sahiptir.

Açıklama / Adımlar:
TCMB, enflasyonu kontrol altında tutmak için politika faizi gibi
araçları PPK toplantılarında belirler.

Referans: TCMB Kurumsal Genel Bakış, tcmb.gov.tr

📚 Sources (3)
```

If the knowledge base doesn't contain the answer, the assistant explicitly says so instead of guessing:

```
Bu bilgi yerel bilgi tabanında mevcut değil.
```

## Uploading Documents

You can expand the knowledge base without restarting the server. Click the 📄 button to open the upload modal, then drag-and-drop or browse for `.md`/`.txt` files. They are chunked and indexed immediately.

### Via File System

1. Add `.md` files to the `docs/` folder (with optional YAML front-matter for title/category/id).
2. Run `npm run ingest` to re-index all documents.

### Document Format

```markdown
---
title: My Document Title
category: Monetary Policy
id: DOC-CUSTOM-001
---

# My Document Title

## Purpose
Short description of what this document covers.

## Key Details
- Fact one.
- Fact two.

## Reference
Source name, url.
```

## Project Structure

```
tcmb-local-rag-assistant/
├── docs/                                       # TCMB knowledge base documents
│   ├── 01-tcmb-genel-bakis.md
│   ├── 02-fiyat-istikrari-enflasyon-hedeflemesi.md
│   ├── 03-ppk-karar-sureci.md
│   ├── 04-para-politikasi-araclari.md
│   ├── 05-tarihsel-2001-2008.md
│   ├── 06-tarihsel-2013-2018.md
│   ├── 07-tarihsel-2021-2023.md
│   ├── 08-tarihsel-2023-2026-guncel.md
│   └── 09-evds-veri-sistemi.md
├── public/
│   └── index.html            # Web UI (single-file, no build step)
├── src/
│   ├── chatEngine.js         # Foundry Local + RAG orchestration + response sanitization
│   ├── chunker.js            # Document chunking + TF-IDF vector computation
│   ├── config.js             # App configuration (model, device, chunk sizes, token limits)
│   ├── ingest.js             # Batch document ingestion script
│   ├── prompts.js            # System prompts (full + compact/edge)
│   ├── server.js             # Express server + API endpoints
│   └── vectorStore.js        # SQLite-backed local vector store
├── test/                     # Unit tests (Node.js test runner)
├── data/                     # Generated at runtime
│   └── rag.db                # SQLite vector database
├── package.json
└── README.md
```

## How the RAG Pipeline Works

### 1. Document Ingestion (`src/ingest.js`)

Reads `.md` files from `docs/`, parses optional YAML front-matter, then splits the content into overlapping chunks (~200 tokens with 25-token overlap). Each chunk is stored with its TF-IDF vector in SQLite.

### 2. Vector Store (`src/vectorStore.js`)

A lightweight vector store backed by SQLite (via `better-sqlite3`). Stores document chunks alongside their TF-IDF vectors. At query time, it cosine-similarity-ranks all chunks against the query vector and returns the top-K results.

### 3. Chat Engine (`src/chatEngine.js`)

Orchestrates the full RAG flow:
- Converts the user's question into a TF-IDF vector
- Retrieves the top-K most relevant chunks
- Builds a prompt with the system instructions + retrieved context + user question
- Sends it to the local Phi-3.5 Mini model via the OpenAI-compatible API
- Streams the response back chunk-by-chunk
- **Sanitizes the output** before it reaches the client (see below)

### 4. System Prompts (`src/prompts.js`)

Two prompt variants:
- **Full mode**: detailed instructions for grounded, structured, source-cited responses, including a worked example
- **Edge mode**: a shorter prompt for faster responses on constrained hardware

## Chunking Strategy

This project uses a **fixed-size sliding window with overlap** (~200 tokens, 25-token overlap), configured in [`src/config.js`](src/config.js) and implemented in [`src/chunker.js`](src/chunker.js).

| Design constraint | How fixed-size chunking helps |
|---|---|
| **Small local model (Phi-3.5 Mini)** | 200-token chunks keep retrieved context compact, leaving room for the system prompt, conversation, and generated output |
| **CPU/GPU execution** | No embedding model needed for chunking: just string operations |
| **Zero extra dependencies** | No tokenizer library, no embedding runtime, no external vector database |
| **Predictable memory/latency** | Every chunk is roughly the same size, so retrieval cost stays consistent |

TF-IDF (instead of a neural embedding model) keeps the whole pipeline lightweight and fully offline — no embedding API or extra model competing with the LLM for memory.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Non-streaming chat completion |
| `POST` | `/api/chat/stream` | Streaming chat via SSE |
| `POST` | `/api/upload` | Upload a document to the knowledge base |
| `GET` | `/api/docs` | List indexed documents |
| `GET` | `/api/health` | Health check |

## Knowledge Base Categories

| # | Category | Documents |
|---|----------|-----------|
| 1 | Kurumsal Bilgi | TCMB's mandate, structure, and organization |
| 2 | Para Politikası | Price stability, inflation targeting, the PPK decision process |
| 3 | Para Politikası Araçları | Policy rate, interest rate corridor, reserve requirements, ROM |
| 4 | Tarihsel Dönemler | Monetary policy history from 2001 to 2026, in five periods |
| 5 | Veri ve Sistemler | EVDS (TCMB's public economic data platform) |

## Edge / Compact Mode

Toggle **Edge Mode** in the UI header for faster, shorter responses:

| Setting | Full Mode | Edge Mode |
|---------|-----------|-----------|
| System prompt | Full, with worked example | Short, minimal |
| Max output tokens | 512 | 256 |
| Retrieved chunks | 3 | 3 |

## Challenges & Solutions (What I Learned)

Adapting this sample to a new domain and running it on constrained local hardware surfaced four real reliability problems. Documenting the fix for each was one of the most valuable parts of this internship project:

### 1. Hallucinated figures
**Problem:** When asked about data not in the knowledge base (e.g. current FX reserves), the model invented a plausible-sounding but fabricated percentage instead of saying it didn't know.
**Fix:** Rewrote the system prompt with an explicit, zero-exception rule: numbers may only be stated if they appear verbatim in the retrieved context; otherwise the model must reply with a fixed refusal sentence. Combined with a code-level check that hard-truncates the response right after that sentence, so any rambling the model adds afterwards never reaches the user.

### 2. Raw context leaking into answers
**Problem:** The model sometimes continued generating after a correct answer and began echoing the raw `--- Document N: ... ---` context blocks it had been given internally.
**Fix:** Added a set of "leak markers" in `chatEngine.js`. If any of them appear in the model's output, the response is truncated immediately before that marker, both in the streaming and non-streaming code paths.

### 3. Unhandled model errors crashing the server
**Problem:** A cancelled/failed model completion (`OperationCanceledException`) was an unhandled promise rejection, which crashes the entire Node.js process by default — taking the whole server down for every user, not just the one whose request failed.
**Fix:** Wrapped the streaming and non-streaming model calls in proper `try`/`catch`/`.catch()` handling, converting failures into a graceful, user-visible error message (or a partial-response notice) instead of a process crash.

### 4. Hardware-specific instability (CPU vs GPU)
**Problem:** On the development machine, forcing CPU inference caused the same cancellation error above once responses got long enough — regardless of the token limit. Manual testing (`foundry run phi-3.5-mini`) confirmed the CPU path was unreliable for longer generations on this hardware, while the GPU path completed the same request without issue.
**Fix:** Changed `preferredDevice` in `config.js` from a forced `"CPU"` to `null` (let the SDK auto-select, preferring GPU), which resolved the crashes.

### 5. Malformed, repeating output
**Problem:** Even after the fixes above, the model sometimes looped back after a well-formed answer and started duplicating the "Referans:" section, occasionally leaking its own internal `Document N:` numbering into the visible reference.
**Fix:** Added a rule to stop generation right after the first complete `Referans:` line — the natural end of a correctly formatted answer — plus a regex-based safety net that strips any leaked `Document N:` labels from the final text, in case the model still slips one in.

## Key Concepts for New Developers

### What is Foundry Local?

[Foundry Local](https://foundrylocal.ai) is Microsoft's on-device AI runtime. It lets you run small language models (SLMs) like Phi-3.5 Mini directly on your machine, with no cloud dependency. The SDK manages model discovery, downloading, loading, and inference programmatically.

```js
import { FoundryLocalManager } from "foundry-local-sdk";

const manager = FoundryLocalManager.create({ appName: "tcmb-local-rag" });
const model = await manager.catalog.getModel("phi-3.5-mini");
await model.load();

const chatClient = model.createChatClient();
const response = await chatClient.completeChat([
  { role: "user", content: "TCMB'nin temel görevi nedir?" }
]);
console.log(response.choices[0].message.content);
```

### What is TF-IDF?

TF-IDF (Term Frequency–Inverse Document Frequency) is a classic information retrieval technique. Each document chunk is converted into a numeric vector based on how important each word is within that chunk relative to all chunks. At query time, the user's question is vectorized the same way and compared against all stored vectors using cosine similarity — no neural embedding model required.

### Why SQLite for Vectors?

For small-to-medium document collections (hundreds to low thousands of chunks), SQLite is fast enough for brute-force cosine similarity search and adds zero infrastructure: just a single `.db` file on disk.

## Running Tests

```bash
npm test
```

Tests use the built-in Node.js test runner (no extra dependencies).

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Ingest | `npm run ingest` | Chunk and index all docs into SQLite |
| Start | `npm start` | Start the server |
| Dev | `npm run dev` | Start with auto-restart on file changes |
| Test | `npm test` | Run unit tests |

## Adapting This for Your Own Use Case

1. **Replace the documents** in `docs/` with your own `.md` files
2. **Edit the system prompt** in `src/prompts.js` to match your domain and tone
3. **Adjust chunk sizes** in `src/config.js`: smaller chunks for precise retrieval, larger for more context
4. **Swap the model** in `src/config.js` to any model available in the Foundry Local catalog
5. **Customise the UI**: the frontend is a single HTML file with inline CSS, easy to modify

## Acknowledgements

Built as an adaptation of Microsoft's official [Foundry Local RAG sample](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-your-first-local-rag-application-with-foundry-local/4501968) as part of a summer internship (Microsoft Türkiye AI Innovator Program).

## License

MIT
