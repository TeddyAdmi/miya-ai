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
    if (String(req.query?.audio || "") === "1") {
      if (target.protocol !== "https:") return res.status(400).json({ ok: false, error: "HTTPS_REQUIRED" });
      const audioHost = target.hostname.toLowerCase();
      const audioAllowed = audioHost === "aurasoundai.ru" || audioHost.endsWith(".aurasoundai.ru") || audioHost === "overchat.s3.eu-north-1.amazonaws.com" || audioHost === "s3.amazonaws.com" || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(audioHost) || /^[a-z0-9.-]+\.s3\.amazonaws\.com$/.test(audioHost) || /^[a-z0-9.-]+\.r2\.dev$/.test(audioHost);
      if (!audioAllowed) return res.status(403).json({ ok: false, error: "AUDIO_HOST_NOT_ALLOWED" });
      const upstreamAudio = await fetch(target.toString(), { headers: { Accept: "audio/*,application/octet-stream;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(25000) });
      if (!upstreamAudio.ok) return res.status(upstreamAudio.status).json({ ok: false, error: "UPSTREAM_AUDIO_HTTP", status: upstreamAudio.status });
      const audioType = String(upstreamAudio.headers.get("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
      if (!(audioType.startsWith("audio/") || audioType === "application/octet-stream" || audioType === "binary/octet-stream")) return res.status(415).json({ ok: false, error: "UPSTREAM_NOT_AUDIO" });
      const length = Number(upstreamAudio.headers.get("content-length") || 0);
      if (length > 100 * 1024 * 1024) return res.status(413).json({ ok: false, error: "AUDIO_TOO_LARGE" });
      const audioBytes = Buffer.from(await upstreamAudio.arrayBuffer());
      if (!audioBytes.length || audioBytes.length > 100 * 1024 * 1024) return res.status(413).json({ ok: false, error: "AUDIO_TOO_LARGE" });
      const requestedName = typeof req.query?.filename === "string" ? req.query.filename : "miya-song.mp3";
      const filename = requestedName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "miya-song.mp3";
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", audioType);
      res.setHeader("Content-Length", String(audioBytes.length));
      res.setHeader("Content-Disposition", 'attachment; filename="' + filename.replace(/["\\]/g, "_") + '"');
      return res.status(200).send(audioBytes);
    }
    const requestedRatio = String(req.query?.ratio || "").trim();
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

    // Agnes PNGs are already valid images. Serve them unchanged when raw=1:
    // no Sharp decode/re-encode, same-origin URL for reliable wall reloads.
    if (String(req.query?.raw || "") === "1") {
      const length = Number(upstream.headers.get("content-length") || 0);
      if (length > 30 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: "IMAGE_TOO_LARGE" });
      }
      const input = Buffer.from(await upstream.arrayBuffer());
      if (!input.length || input.length > 30 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: "IMAGE_TOO_LARGE" });
      }
      res.setHeader("Content-Type", type.split(";")[0]);
      res.setHeader("Content-Length", String(input.length));
      res.setHeader("Content-Disposition", 'inline; filename="miya-image"');
      return res.status(200).send(input);
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
