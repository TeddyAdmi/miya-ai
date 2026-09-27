module.exports = async function imageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body && typeof req.body === "object" ? req.body : {});

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });
    }

    const model = typeof body.model === "string" ? body.model.trim() : "FLUX Dev";
    const wantsKontext = /kontext/i.test(model);
    const options = body.options && typeof body.options === "object" ? body.options : {};
    const imageUrl = typeof options.imageUrl === "string" ? options.imageUrl.trim() : "";
    const imageBase64 = typeof options.imageBase64 === "string" ? options.imageBase64.trim() : "";
    const isImageToImage = wantsKontext && Boolean(imageUrl || imageBase64);

    if (wantsKontext && !isImageToImage) {
      return res.status(400).json({
        ok: false,
        error: "KONTEXT_SOURCE_REQUIRED",
        message: "Для Flux Kontext Dev нужно загрузить исходное изображение."
      });
    }

    const ratio = typeof body.ratio === "string" ? body.ratio : "16:9";
    const requestedCopies = Number(body.copies ?? body.count ?? 1);
    const copies = Number.isFinite(requestedCopies)
      ? Math.max(1, Math.min(4, Math.round(requestedCopies)))
      : 1;

    const payload = {
      prompt,
      ratio: isImageToImage && ratio === "1:1" ? "auto" : ratio
    };

    if (copies > 1 && !isImageToImage) {
      payload.copies = copies;
      payload.count = copies;
    }

    if (imageUrl) {
      const source = await fetch(imageUrl, { headers: { Accept: "image/*" } });
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
      payload.imageBase64 = "data:" + mime + ";base64," + bytes.toString("base64");
    } else if (imageBase64) {
      payload.imageBase64 = imageBase64;
    }

    if (isImageToImage) {
      const sourceData = String(payload.imageBase64 || "");
      const match = sourceData.match(/^data:image\/[^;]+;base64,(.+)$/i);
      const rawBase64 = match
        ? match[1].replace(/\s+/g, "")
        : sourceData.replace(/^base64,/i, "").replace(/\s+/g, "");

      if (rawBase64.length < 100) {
        return res.status(400).json({ ok: false, error: "INVALID_IMAGE_BASE64" });
      }

      if (Math.ceil(rawBase64.length * 3 / 4) > 3.5 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: "SOURCE_IMAGE_TOO_LARGE" });
      }

      payload.imageBase64 = rawBase64;
      payload.prompt = prompt + "\n\nSTRICT IMAGE EDIT — FLUX KONTEXT DEV:\n- Preserve the source image and change only what the user explicitly requests.\n- Preserve identity, anatomy, proportions, pose, composition, lighting, shadows and background unless explicitly requested otherwise.\n- Create exactly the requested number of objects. Never duplicate objects or body parts.\n- Return one coherent photorealistic image with no collage, watermark or unrequested objects.";
    }

    const endpointPath = isImageToImage ? "/api/pti" : "/api/tti";
    const hosts = ["https://ahm7xmakki.com", "https://www.ahm7xmakki.com"];
    let lastError = "";

    for (const host of hosts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), isImageToImage ? 58000 : 30000);

      try {
        const upstream = await fetch(host + endpointPath, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}

        if (!upstream.ok || data?.success === false) {
          lastError = raw.slice(0, 500);
          continue;
        }

        const urls = Array.isArray(data.imageUrls)
          ? data.imageUrls
          : Array.isArray(data.images)
            ? data.images.map(x => typeof x === "string" ? x : x?.imageUrl)
            : data.imageUrl
              ? [data.imageUrl]
              : [];

        const imageUrls = urls.filter(x => typeof x === "string" && /^https?:\/\//i.test(x));
        if (!imageUrls.length) {
          lastError = "FLUX_IMAGE_URL_MISSING";
          continue;
        }

        return res.status(200).json({
          ok: true,
          mode: "image",
          status: "completed",
          provider: "PixelSter",
          model: isImageToImage ? "Flux Kontext Dev" : "Flux Dev",
          imageUrl: imageUrls[0],
          imageUrls,
          count: imageUrls.length,
          meta: { free: true, endpoint: endpointPath, edit: isImageToImage }
        });
      } catch (error) {
        lastError = error?.message || String(error);
      } finally {
        clearTimeout(timer);
      }
    }

    return res.status(502).json({
      ok: false,
      error: "FLUX_UPSTREAM_FAILED",
      message: isImageToImage ? "Flux Kontext Dev не вернул изображение." : "Flux Dev не вернул изображение.",
      detail: lastError
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "IMAGE_HANDLER_ERROR",
      message: error?.message || "Ошибка обработчика изображений."
    });
  }
};
