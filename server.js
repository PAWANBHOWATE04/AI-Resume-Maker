require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

if (!ANTHROPIC_API_KEY) {
  console.warn(
    "[warn] ANTHROPIC_API_KEY is not set. Set it in your environment or .env file before making AI requests."
  );
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health check for load balancers / App Runner
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Builds the prompt server-side so the frontend never constructs
// or sees raw system/model instructions, and never touches the API key.
function buildPrompt(task, fields = {}) {
  const clean = (v) => (typeof v === "string" ? v.trim() : "");

  switch (task) {
    case "summary": {
      const { title, summary, experienceText, skills } = fields;
      if (clean(summary)) {
        return (
          "You are a professional resume writer. Rewrite the following resume summary so it is " +
          "concise (2-3 sentences), achievement-oriented, written with no pronouns, and free of cliches. " +
          "Return only the rewritten summary text, no preamble, no quotation marks.\n\n" +
          `Job title: ${clean(title)}\nCurrent summary: ${clean(summary)}`
        );
      }
      return (
        "You are a professional resume writer. Write a concise 2-3 sentence professional resume summary " +
        `for a "${clean(title)}" based on this experience and skills. No pronouns, no cliches. ` +
        "Return only the summary text, no preamble, no quotation marks.\n\n" +
        `Experience: ${clean(experienceText)}\nSkills: ${clean(skills)}`
      );
    }
    case "bullets": {
      const { role, company, bulletsText } = fields;
      return (
        "You are a professional resume writer. Rewrite the following resume bullet points so each one " +
        "starts with a strong action verb, is achievement-oriented, and is concise. Keep the same number " +
        "of bullets. Do not invent false numbers or facts. Return only the bullets, one per line, with no " +
        "bullet symbols and no preamble.\n\n" +
        `Role: ${clean(role)} at ${clean(company)}\nCurrent bullets:\n${clean(bulletsText)}`
      );
    }
    case "project": {
      const { name, description } = fields;
      return (
        "You are a professional resume writer. Rewrite the following project description to be one " +
        "concise, achievement-oriented sentence (max 30 words) suitable for a resume. Return only the " +
        "rewritten sentence, no preamble, no quotation marks.\n\n" +
        `Project: ${clean(name)}\nCurrent description: ${clean(description)}`
      );
    }
    default:
      return null;
  }
}

// Streams a live Claude response to the browser using Server-Sent Events.
// The API key stays on the server at all times.
app.post("/api/enhance", async (req, res) => {
  const { task, fields } = req.body || {};
  const prompt = buildPrompt(task, fields);

  if (!prompt) {
    return res.status(400).json({ error: "Unknown or invalid task." });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    sendEvent("error", { message: "Could not reach the AI provider." });
    return res.end();
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "AI request failed.";
    try {
      const errJson = await upstream.json();
      detail = errJson?.error?.message || detail;
    } catch (_) {}
    sendEvent("error", { message: detail });
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  req.on("close", () => {
    try {
      reader.cancel();
    } catch (_) {}
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep the trailing partial line for next chunk

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        let evt;
        try {
          evt = JSON.parse(raw);
        } catch (_) {
          continue;
        }

        if (evt.type === "content_block_delta" && evt.delta?.text) {
          sendEvent("delta", { text: evt.delta.text });
        } else if (evt.type === "error") {
          sendEvent("error", { message: evt.error?.message || "Stream error." });
        }
      }
    }
    sendEvent("done", {});
  } catch (err) {
    sendEvent("error", { message: "Stream interrupted." });
  } finally {
    res.end();
  }
});

// Fallback to index.html for any non-API route (simple SPA-style routing)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Resume Maker server listening on port ${PORT}`);
});
