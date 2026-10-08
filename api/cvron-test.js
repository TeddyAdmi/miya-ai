const ENDPOINTS = {
  "FLUX Dev": "https://cvron.alwaysdata.net/cvronai/flux-dev.php",
  "DALL-E 3": "https://cvron.alwaysdata.net/cvronai/multi-gen.php?model=dalle-three",
  "Stable Diffusion 3.5 Large": "https://cvron.alwaysdata.net/cvronai/multi-gen.php?model=stable-diffusion-v35-large",
  "ChatGPT Imager": "https://cvron.alwaysdata.net/cvronai/chatgpt-imager.php",
  "Flux 2 Klein": "https://cvron.alwaysdata.net/cvronvip/flux-2-klein.php",
  "Image To Image": "https://cvron.alwaysdata.net/cvronai/image2image.php"
};

const DEFAULT_PROMPT = "A professional studio photograph of a single red apple on a clean neutral table, realistic lighting, high detail.";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.json(body);
}

module.exports = async function cvronTest(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, {ok:false, error:"METHOD_NOT_ALLOWED"});
  }

  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const requested = String(req.query?.model || body.model || "all").trim();
  const prompt = String(req.query?.prompt || body.prompt || DEFAULT_PROMPT).trim();
  const imageUrl = String(req.query?.imageUrl || body.imageUrl || "https://placehold.co/512x512.png").trim();

  const models = requested === "all" ? Object.keys(ENDPOINTS) : [requested];
  const unknown = models.filter(name => !ENDPOINTS[name]);
  if (unknown.length) return json(res, 400, {ok:false, error:"UNKNOWN_MODEL", available:Object.keys(ENDPOINTS), unknown});

  const results = [];

  for (const model of models) {
    const base = ENDPOINTS[model];
    const target = new URL(base);
    target.searchParams.set("prompt", prompt);
    if (model === "Image To Image") target.searchParams.set("image_url", imageUrl);

    const started = Date.now();
    let response = null;
    let raw = "";
    let error = "";

    try {
      response = await fetch(target.toString(), {
        method: "GET",
        headers: {Accept:"application/json, text/plain, */*"},
        cache: "no-store",
        signal: AbortSignal.timeout(180000)
      });
      raw = await response.text();
    } catch (e) {
      error = String(e?.message || e || "fetch failed");
    }

    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}

    const findUrl = (value, seen = new Set()) => {
      if (value == null) return "";
      if (typeof value === "string") {
        const v = value.trim();
        return /^https?:\/\//i.test(v) ? v : "";
      }
      if (typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);
      for (const key of ["imageUrl","image_url","url","image","outputUrl","output_url","output","result","data"]) {
        const found = findUrl(value[key], seen);
        if (found) return found;
      }
      for (const key of Object.keys(value)) {
        const found = findUrl(value[key], seen);
        if (found) return found;
      }
      return "";
    };

    results.push({
      model,
      endpoint: base,
      httpStatus: response?.status || 0,
      ok: Boolean(response?.ok),
      elapsedMs: Date.now() - started,
      contentType: response?.headers?.get("content-type") || "",
      imageUrl: findUrl(parsed) || findUrl(raw),
      error,
      body: raw.slice(0, 3000)
    });
  }

  return json(res, 200, {
    ok: true,
    testedAt: new Date().toISOString(),
    prompt,
    imageUrl,
    results
  });
};
