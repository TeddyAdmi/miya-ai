async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const cleanMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));

    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";

    if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== "user") {
      return res.status(400).json({
        ok: false,
        error: "USER_MESSAGE_REQUIRED",
        message: "Нужно сообщение пользователя."
      });
    }

    const system =
      "Ты Miya, дружелюбный AI-помощник внутри Miya AI Studio. " +
      "Отвечай на русском, если пользователь пишет по-русски. " +
      "Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. " +
      "Отвечай полезно и по существу.";

    if (imageBase64) {
      const visionPayload = {
        image: imageBase64,
        userPrompt: cleanMessages[cleanMessages.length - 1].content,
        messages: cleanMessages.slice(-12).map(m => ({
          type: m.role === "assistant" ? "ai" : "user",
          content: m.content
        }))
      };

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        const upstream = await fetch("https://ahm7xmakki.com/api/imgchat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(visionPayload),
          signal: controller.signal
        });
        clearTimeout(timer);

        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}

        const answer = String(data?.response || data?.text || data?.message || "").trim();
        if (upstream.ok && answer) {
          return res.status(200).json({
            ok: true, mode: "chat", text: answer,
            model: "VisionSter", provider: "AHM7 Vision"
          });
        }

        return res.status(502).json({
          ok: false,
          error: "VISION_UPSTREAM_FAILED",
          message: "Сервис анализа изображения временно недоступен.",
          upstreamStatus: upstream.status
        });
      } catch (error) {
        return res.status(502).json({
          ok: false,
          error: "VISION_UPSTREAM_FAILED",
          message: "Не удалось подключиться к сервису анализа изображения.",
          detail: String(error?.message || error)
        });
      }
    }

    const chatPayload = {
      messages: [
        { role: "system", content: system },
        ...cleanMessages.slice(-12)
      ],
      max_tokens: 1024
    };

    async function callBlockRun(model) {
      const started = Date.now();
      try {
        const response = await fetch("https://blockrun.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ ...chatPayload, model }),
          signal: AbortSignal.timeout(20000)
        });

        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}

        const answer = String(data?.choices?.[0]?.message?.content || "").trim();

        if (response.ok && answer) {
          return {
            ok: true,
            text: answer,
            model: String(data?.model || model),
            provider: "BlockRun",
            status: response.status,
            elapsedMs: Date.now() - started
          };
        }

        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          provider: "BlockRun",
          model,
          elapsedMs: Date.now() - started,
          upstreamBody: raw.slice(0, 4000),
          upstreamError: data?.error || data?.message || null
        };
      } catch (error) {
        return {
          ok: false,
          status: null,
          provider: "BlockRun",
          model,
          elapsedMs: Date.now() - started,
          upstreamBody: "",
          upstreamError: String(error?.message || error)
        };
      }
    }


    // Primary free keyless provider. Fall back only if it fails.
    let result = await callBlockRun("nvidia/gpt-oss-20b");

    if (!result.ok) {
      result = await callBlockRun("nvidia/nemotron-3.5-super");
    }

    if (!result.ok) {
      result = await callVireonix("auto");
    }

    if (!result.ok) {
      result = await callFaucet("auto:fast");
    }

    if (result.ok) {
      return res.status(200).json({
        ok: true,
        mode: "chat",
        text: result.text,
        model: result.model,
        provider: result.provider
      });
    }

    return res.status(502).json({
      ok: false,
      error: "CHAT_UPSTREAM_FAILED",
      message: "Бесплатные AI-сервисы чата временно недоступны.",
      upstream: result.provider || "unknown",
      upstreamStatus: result.status,
      upstreamStatusText: result.statusText || "",
      upstreamError: result.upstreamError,
      upstreamBody: result.upstreamBody,
      elapsedMs: result.elapsedMs
    });

  } catch (error) {
    console.error("Miya Chat:", error);
    return res.status(500).json({
      ok: false,
      error: "CHAT_HANDLER_ERROR",
      message: "Ошибка обработки запроса Miya.",
      detail: String(error?.message || error)
    });
  }
}

module.exports = handler;
