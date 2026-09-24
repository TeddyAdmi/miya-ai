export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured",
      message: "Добавь GEMINI_API_KEY в Vercel Environment Variables."
    });
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gemini-3.8-flash";

    const contents = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 12000) }]
      }));

    if (!contents.length || contents[contents.length - 1].role !== "user") {
      return res.status(400).json({ error: "A user message is required" });
    }

    const requestBody = {
      systemInstruction: {
        parts: [{
          text: "Ты Miya — дружелюбный AI-помощник внутри Miya AI Studio. Отвечай на русском, если пользователь пишет по-русски. Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. Не утверждай, что ты можешь выполнить действие, если оно не подключено."
        }]
      },
      contents,
      generationConfig: {
        thinkingConfig: { thinkingLevel: "low" },
        maxOutputTokens: 2048
      }
    };

    let response;
    let data = {};
    let lastStatus = 500;

    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        }
      );

      data = await response.json().catch(() => ({}));
      lastStatus = response.status;

      if (response.ok) break;

      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        const message =
          data?.error?.message ||
          data?.message ||
          `Gemini API error: HTTP ${response.status}`;
        return res.status(response.status).json({ error: message });
      }

      await new Promise(resolve => setTimeout(resolve, 800 * Math.pow(2, attempt)));
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(502).json({
        error: "Gemini returned an empty response"
      });
    }

    return res.status(200).json({
      text,
      model,
      usage: data?.usageMetadata || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Gemini request failed"
    });
  }
}
