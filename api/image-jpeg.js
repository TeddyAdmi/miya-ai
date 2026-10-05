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
      "cleverutil.com"
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

    const jpeg = await sharp(input)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, mozjpeg: true })
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
