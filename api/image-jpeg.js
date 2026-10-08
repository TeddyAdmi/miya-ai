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
      "overchat.s3.eu-north-1.amazonaws.com",
      "tmpfiles.org",
      "www.tmpfiles.org"
    ];
    if (!allowed.includes(host)) {
      return res.status(403).json({ ok: false, error: "IMAGE_HOST_NOT_ALLOWED" });
    }

    // Follow redirects manually and re-check every destination against the
    // image-host allowlist. tmpfiles.org download links may redirect, but this
    // endpoint must not become an unrestricted URL fetcher.
    let fetchUrl = target;
    let upstream;
    for (let redirect = 0; redirect <= 5; redirect++) {
      const fetchHost = fetchUrl.hostname.toLowerCase();
      if (fetchUrl.protocol !== "https:" || !allowed.includes(fetchHost)) {
        return res.status(403).json({ ok: false, error: "IMAGE_REDIRECT_HOST_NOT_ALLOWED" });
      }
      upstream = await fetch(fetchUrl.toString(), {
        redirect: "manual",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
          Referer: "https://tmpfiles.org/"
        },
        signal: AbortSignal.timeout(45000)
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || redirect === 5) {
        return res.status(502).json({ ok: false, error: "IMAGE_REDIRECT_FAILED" });
      }
      try {
        fetchUrl = new URL(location, fetchUrl);
      } catch {
        return res.status(502).json({ ok: false, error: "IMAGE_REDIRECT_INVALID" });
      }
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: "UPSTREAM_IMAGE_HTTP", status: upstream.status });
    }

    const type = String(upstream.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) {
      const upstreamBody = await upstream.text().catch(() => "");
      // If tmpfiles returns its file landing page, expose the actual download
      // links and form actions so we can identify the direct-file endpoint.
      const upstreamLinks = [...upstreamBody.matchAll(/(?:href|src|action)\\s*=\\s*["']([^"']+)["']/gi)]
        .map(match => match[1])
        .filter(value => /download|\\/dl\\/|file|image|download/i.test(value))
        .slice(0, 20);
      return res.status(415).json({
        ok: false,
        error: "UPSTREAM_NOT_IMAGE",
        upstreamContentType: type || "unknown",
        upstreamUrl: fetchUrl.toString(),
        upstreamStatus: upstream.status,
        upstreamLinks,
        upstreamBody: upstreamBody.slice(0, 300)
      });
    }

    const input = Buffer.from(await upstream.arrayBuffer());
    if (!input.length || input.length > 30 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "IMAGE_TOO_LARGE" });
    }

    // If the caller did not request a ratio conversion, return the provider's
    // original image bytes. Avoid decoding/re-encoding large PNGs with Sharp.
    if (!targetRatio) {
      res.setHeader("Content-Type", type.split(";")[0] || "application/octet-stream");
      res.setHeader("Content-Length", String(input.length));
      res.setHeader("Content-Disposition", 'inline; filename="miya-source-image"');
      return res.status(200).send(input);
    }

    // Load Sharp only for requested ratio conversion. Plain proxy requests must
    // still work even if the optional native Sharp runtime cannot initialize.
    let sharp;
    try {
      sharp = require("sharp");
    } catch (error) {
      return res.status(503).json({
        ok: false,
        error: "IMAGE_RESIZER_UNAVAILABLE",
        message: "Преобразование размера временно недоступно.",
        detail: error?.message || "Sharp failed to initialize."
      });
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

module.exports.config = { maxDuration: 60 };
