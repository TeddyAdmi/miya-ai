module.exports = async function imageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

    const ratio = typeof body.ratio === "string" ? body.ratio : "16:9";
    const model = typeof body.model === "string" ? body.model.trim() : "Flux Dev";
    const options = body.options && typeof body.options === "object" ? body.options : {};
    const imageUrl = typeof options.imageUrl === "string" ? options.imageUrl.trim() : "";
    const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";
    const isImageToImage = /kontext/i.test(model) && Boolean(imageUrl || imageBase64);

    if (/kontext/i.test(model) && !isImageToImage) {
      return res.status(400).json({
        ok: false,
        error: "KONTEXT_SOURCE_REQUIRED",
        message: "Для Flux Kontext Dev нужно загрузить исходное изображение."
      });
    }

    // Keep the proven AHM7 FLUX Dev contract exact: prompt + ratio only.
    // Add a concise anatomy guard because FLUX can otherwise duplicate limbs
    // when several hand/arm poses are described in one scene.
    if (!isImageToImage) {
      const anatomyPrompt = prompt + "\n\nANATOMY CONSISTENCY: exactly one person with exactly two arms and exactly two hands. Each arm must connect naturally to one shoulder and each hand to one wrist. Do not generate extra arms, hands, fingers, duplicated limbs, detached limbs, or limbs growing from the torso, legs, table, or background. Keep the requested pose physically coherent and anatomically realistic.";
      const upstream = await fetch("https://ahm7xmakki.com/api/tti", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: anatomyPrompt, ratio }),
        signal: AbortSignal.timeout(55000)
      });

      const raw = await upstream.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}

      if (!upstream.ok) {
        if (upstream.status === 403) {
          return res.status(403).json({
            ok: false,
            error: "PROMPT_MODERATION_BLOCKED",
            message: "Промпт отклонён модерацией. Измените формулировку запроса и попробуйте снова."
          });
        }
        return res.status(502).json({
          ok: false,
          error: "FLUX_UPSTREAM_HTTP",
          message: "AHM7 /api/tti вернул HTTP " + upstream.status + ".",
          upstreamStatus: upstream.status,
          upstreamBody: raw.slice(0, 800)
        });
      }

      const imageUrlResult = typeof data.imageUrl === "string" && /^https?:\/\//i.test(data.imageUrl)
        ? data.imageUrl
        : null;

      if (!imageUrlResult) {
        return res.status(502).json({
          ok: false,
          error: "FLUX_IMAGE_URL_MISSING",
          message: "AHM7 /api/tti не вернул imageUrl.",
          upstreamBody: raw.slice(0, 800)
        });
      }

      return res.status(200).json({
        ok: true,
        mode: "image",
        status: "completed",
        provider: "PixelSter",
        model: "Flux Dev",
        imageUrl: imageUrlResult,
        imageUrls: [imageUrlResult],
        count: 1,
        meta: { free: true, endpoint: "/api/tti", edit: false }
      });
    }

    // Kontext keeps the existing proven raw-base64 /api/pti contract.
    let sourceBase64 = imageBase64;
    if (imageUrl) {
      const source = await fetch(imageUrl, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(15000) });
      if (!source.ok) {
        return res.status(400).json({
          ok: false,
          error: "SOURCE_IMAGE_FETCH_FAILED",
          message: "Не удалось получить исходное изображение (HTTP " + source.status + ")."
        });
      }
      const bytes = Buffer.from(await source.arrayBuffer());
      if (bytes.length > 3.5 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: "SOURCE_IMAGE_TOO_LARGE" });
      }
      const type = source.headers.get("content-type") || "image/jpeg";
      const mime = /^image\/(jpeg|png|webp)$/i.test(type) ? type.split(";")[0] : "image/jpeg";
      sourceBase64 = "data:" + mime + ";base64," + bytes.toString("base64");
    }

    const match = String(sourceBase64 || "").match(/^data:image\/[^;]+;base64,(.+)$/i);
    const rawBase64 = match
      ? match[1].replace(/\s+/g, "")
      : String(sourceBase64 || "").replace(/^base64,/i, "").replace(/\s+/g, "");

    if (rawBase64.length < 100) {
      return res.status(400).json({ ok: false, error: "INVALID_IMAGE_BASE64" });
    }

    if (Math.ceil(rawBase64.length * 3 / 4) > 3.5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "SOURCE_IMAGE_TOO_LARGE" });
    }

    const editPrompt = prompt + "\n\nSTRICT IMAGE EDIT — FLUX KONTEXT DEV:\n- Use the supplied image as the exact source image.\n- Preserve the original subject, identity, anatomy, clothing, pose, camera angle, composition, lighting and environment unless explicitly requested otherwise.\n- Make only the requested modification.\n- Create exactly the requested number of objects. Never duplicate objects or body parts.\n- Return one coherent photorealistic image, not a collage.";

    const upstream = await fetch("https://ahm7xmakki.com/api/pti", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        prompt: editPrompt,
        ratio: ratio === "1:1" ? "auto" : ratio,
        imageBase64: rawBase64
      }),
      signal: AbortSignal.timeout(55000)
    });

    const raw = await upstream.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_KONTEXT_UPSTREAM_HTTP",
        message: "AHM7 /api/pti вернул HTTP " + upstream.status + ".",
        upstreamStatus: upstream.status,
        upstreamBody: raw.slice(0, 800)
      });
    }

    const imageUrlResult = typeof data.imageUrl === "string" && /^https?:\/\//i.test(data.imageUrl)
      ? data.imageUrl
      : Array.isArray(data.imageUrls) && typeof data.imageUrls[0] === "string"
        ? data.imageUrls[0]
        : null;

    if (!imageUrlResult) {
      return res.status(502).json({
        ok: false,
        error: "FLUX_KONTEXT_IMAGE_URL_MISSING",
        message: "AHM7 /api/pti не вернул imageUrl.",
        upstreamBody: raw.slice(0, 800)
      });
    }

    return res.status(200).json({
      ok: true,
      mode: "image",
      status: "completed",
      provider: "PixelSter",
      model: "Flux Kontext Dev",
      imageUrl: imageUrlResult,
      imageUrls: [imageUrlResult],
      count: 1,
      meta: { free: true, endpoint: "/api/pti", edit: true }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        ok: false,
        error: "FLUX_TIMEOUT",
        message: "AHM7 не завершил запрос в течение 55 секунд."
      });
    }

    return res.status(502).json({
      ok: false,
      error: "FLUX_HANDLER_ERROR",
      message: error?.message || "Ошибка обращения к FLUX.",
    });
  }
};
