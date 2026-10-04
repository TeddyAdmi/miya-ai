module.exports = async function imageHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") {
    try {
      const raw = String(req.query?.url || "").trim();
      if (!raw) return res.status(400).json({ ok: false, error: "IMAGE_URL_REQUIRED" });
      const target = new URL(raw);
      const host = target.hostname.toLowerCase();
      const allowed =
        host === "modelscope.cn" ||
        host.endsWith(".modelscope.cn") ||
        host.endsWith(".aliyuncs.com") ||
        host.endsWith(".oss-cn-beijing.aliyuncs.com");
      if (target.protocol !== "https:" || !allowed) {
        return res.status(400).json({ ok: false, error: "IMAGE_URL_HOST_NOT_ALLOWED" });
      }
      const upstream = await fetch(target.toString(), { cache: "no-store" });
      if (!upstream.ok) return res.status(upstream.status).json({ ok: false, error: "IMAGE_PROXY_FAILED", upstreamStatus: upstream.status });
      const type = upstream.headers.get("content-type") || "image/jpeg";
      if (!/^image\//i.test(type)) return res.status(502).json({ ok: false, error: "UPSTREAM_NOT_IMAGE" });
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error || "Image proxy failed") });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

    const ratio = typeof body.ratio === "string" ? body.ratio : "16:9";

    if (model === "ModelScope · Z-Image-Turbo") {
      const token = String(process.env.MODELSCOPE_TOKEN || "").trim();
      if (!token) return res.status(500).json({ ok: false, error: "MODELSCOPE_TOKEN_NOT_CONFIGURED" });

      const response = await fetch("https://api-inference.modelscope.cn/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "X-ModelScope-Async-Mode": "true"
        },
        body: JSON.stringify({
          model: "Tongyi-MAI/Z-Image-Turbo",
          prompt: prompt.slice(0, 4000)
        }),
        signal: AbortSignal.timeout(55000)
      });

      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          error: "MODELSCOPE_GENERATION_FAILED",
          message: String(data?.message || data?.error || raw).slice(0, 1200),
          upstreamStatus: response.status
        });
      }

      let imageUrl = String(
        data?.output_images?.[0] ||
        data?.images?.[0]?.url ||
        data?.image_url ||
        ""
      );
      const taskId = String(data?.task_id || "").trim();

      if (taskId && !imageUrl) {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2500));
          const statusResponse = await fetch(
            "https://api-inference.modelscope.cn/v1/tasks/" + encodeURIComponent(taskId),
            {
              headers: {
                "Authorization": "Bearer " + token,
                "X-ModelScope-Task-Type": "image_generation"
              },
              cache: "no-store"
            }
          );
          const statusRaw = await statusResponse.text();
          let statusData = {};
          try { statusData = statusRaw ? JSON.parse(statusRaw) : {}; } catch {}
          const state = String(statusData?.task_status || "").toUpperCase();

          if (state === "SUCCEED" || state === "SUCCESS" || state === "COMPLETED") {
            imageUrl = String(
              statusData?.output_images?.[0] ||
              statusData?.images?.[0]?.url ||
              statusData?.image_url ||
              ""
            );
            if (imageUrl) break;
          }
          if (state === "FAILED" || state === "ERROR") {
            return res.status(502).json({
              ok: false,
              error: "MODELSCOPE_TASK_FAILED",
              message: String(statusData?.message || statusData?.error || "Task failed").slice(0, 1200),
              taskId
            });
          }
        }
      }

      if (!imageUrl) {
        return res.status(504).json({ ok: false, error: "MODELSCOPE_IMAGE_TIMEOUT", taskId: taskId || null });
      }

      return res.status(200).json({
        ok: true,
        mode: "image",
        status: "completed",
        provider: "ModelScope",
        model: "Tongyi-MAI/Z-Image-Turbo",
        taskId: taskId || null,
        imageUrl: "/api/image?url=" + encodeURIComponent(imageUrl),
        imageUrls: ["/api/image?url=" + encodeURIComponent(imageUrl)],
        count: 1
      });
    }
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

    // Keep the proven Kontext contract: send the user's edit prompt unchanged.
    // Extra moderation-sensitive guard text can cause otherwise valid prompts
    // to be rejected upstream by AHM7.
    const editPrompt = prompt;

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
