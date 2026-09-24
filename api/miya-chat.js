export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

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
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gemini-3.5-flash-lite";

    const contents = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 12000) }]
      }));

    if (!contents.length || contents[contents.length - 1].role !== "user") {
      return res.status(400).json({ error: "A user message is required" });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || data?.message || `Gemini API error: HTTP ${response.status}`
      });
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(502).json({ error: "Gemini returned an empty response" });
    }

    return res.status(200).json({
      text,
      model,
      usage: data?.usageMetadata || null
    });
  } catch (error) {
    console.error("Miya chat:", error);
    return res.status(500).json({
      error: error?.message || "Gemini request failed"
    });
  }
}