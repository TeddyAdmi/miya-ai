const sharp = require("sharp");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const rawUrl = typeof req.query?.url === "string" ? req.query.url.trim() : "";
    if (!/^https?:\/\//i.test(rawUrl)) {
      return res.status(400).json({ ok: false, error: "IMAGE_URL_REQUIRED" });
    }

    const target = new URL(rawUrl);
    const requestedRatio = String(req.query?.ratio || "").trim();
    const enhance = String(req.query?.enhance || "").trim() === "1";
    const ratioMatch = requestedRatio.match(/^(\d+):(\d+)$/);
    let targetRatio = 0;
    if (ratioMatch) {
      const rw = Number(ratioMatch[1]), rh = Number(ratioMatch[2]);
      if (rw > 0 && rh > 0 && rw <= 100 && rh <= 100) targetRatio = rw / rh;
    }
    // Some CleverUtils MCP responses have historically returned the provider host
    // without the final "s". Normalize that legacy typo before the allowlist check
    // so the browser never receives a dead cleverutil host.
    if (target.hostname.toLowerCase() === "cleverutil" || target.hostname.toLowerCase() === "cleverutil.com") {
      target.hostname = "cleverutils.com";
    }
    const host = target.hostname.toLowerCase();

    // Only allow image hosts used by Miya/providers. This prevents turning the
    // endpoint into an arbitrary internal-network fetcher.
    const allowed = [
      "ahm7xmakki.com",
      "www.ahm7xmakki.com",
      "platform-outputs.agnes-ai.space",
      "cos-platform-outputs.agnes-ai.cn",
      "access.vheer.com",
      "cleverutils.com",
      "www.cleverutils.com",
      "cleverutil",
      "cleverutil.com",
      "overchat.s3.eu-north-1.amazonaws.com"
    ];
    if (!allowed.includes(host)) {
      return res.status(403).json({ ok: false, error: "IMAGE_HOST_NOT_ALLOWED" });
    }

    const upstream = await fetch(target.toString(), {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: "UPSTREAM_IMAGE_HTTP", status: upstream.status });
    }

    const type = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) {
      return res.status(415).json({ ok: false, error: "UPSTREAM_NOT_IMAGE" });
    }

    const input = Buffer.from(await upstream.arrayBuffer());
    if (!input.length || input.length > 30 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "IMAGE_TOO_LARGE" });
    }

    let imagePipeline = sharp(input).rotate();

    if (targetRatio) {
      const width = targetRatio >= 1 ? 1536 : 864;
      const height = Math.max(1, Math.round(width / targetRatio));
      imagePipeline = imagePipeline.resize(width, height, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: false
      });
    }

    // Nano Banana finish: brighter, richer and slightly sharper, without
    // adding borders, blurred side panels, or changing the composition.
    if (enhance) {
      imagePipeline = imagePipeline
        .modulate({ brightness: 1.06, saturation: 1.12 })
        .sharpen({ sigma: 0.65, m1: 0.8, m2: 2.0 });
    }

    const jpeg = await imagePipeline
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 94, mozjpeg: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(jpeg.length));
    res.setHeader("Content-Disposition", 'inline; filename="miya-image.jpg"');
    return res.status(200).send(jpeg);
  } catch (e) {
    return res.status(e?.name === "TimeoutError" ? 504 : 502).json({
      ok: false,
      error: "JPEG_CONVERSION_FAILED",
      message: e?.message || "Не удалось преобразовать изображение в JPEG."
    });
  }
};

module.exports.config = { maxDuration: 30 };
