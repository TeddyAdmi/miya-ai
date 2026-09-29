async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!req || req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ ok:false, error:"PROMPT_REQUIRED" });

    const provider=String(body.provider||"").trim().toLowerCase();

    if(provider==="pixelster"){
      const pixelPrompt=String(body.prompt||"").trim();
      const pixelSource=String(body?.options?.imageBase64||body.imageBase64||"").trim();
      if(!pixelPrompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
      if(!pixelSource) return res.status(400).json({ok:false,error:"PIXELSTER_SOURCE_REQUIRED",message:"PixelSter Motion Synthesis требует исходное изображение."});

      const upstream=await fetch("https://ahm7xmakki.com/api/ptv",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          prompt:pixelPrompt,
          ratio:String(body.ratio||"auto"),
          duration:Number(body.duration)||10,
          imageBase64:pixelSource
        }),
        signal:AbortSignal.timeout(290000)
      });
      const raw=await upstream.text();
      let data={};try{data=raw?JSON.parse(raw):{}}catch{}
      if(!upstream.ok||data?.success===false||!data?.videoUrl){
        return res.status(upstream.status>=400&&upstream.status<600?upstream.status:502).json({
          ok:false,
          error:"PIXELSTER_FAILED",
          message:String(data?.error||data?.message||raw||("PixelSter HTTP "+upstream.status)).slice(0,700),
          upstreamStatus:upstream.status||null
        });
      }
      return res.status(200).json({
        ok:true,mode:"video",provider:"PixelSter",model:"PixelSter Motion Synthesis",
        videoUrl:String(data.videoUrl),
        meta:{free:true,endpoint:"/api/ptv"}
      });
    }

    const { Client, handle_file } = await import("@gradio/client");
    const sourceBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    let inputImage = null;

    if (sourceBase64) {
      const match = sourceBase64.match(/^data:image\/[^;]+;base64,(.+)$/i);
      const raw = match
        ? match[1].replace(/\s+/g, "")
        : sourceBase64.replace(/^base64,/i, "").replace(/\s+/g, "");
      if (raw.length < 100) {
        return res.status(400).json({ ok:false, error:"INVALID_IMAGE_BASE64" });
      }
      inputImage = handle_file(Buffer.from(raw, "base64"));
    }

    const canvas = typeof body.canvas === "string" && body.canvas.trim()
      ? body.canvas.trim()
      : "960x544 · 16:9 fast";

    const requestedDuration = Number(body.duration);
    const duration = Number.isFinite(requestedDuration)
      ? Math.max(5, Math.min(14, Math.round(requestedDuration)))
      : 5;

    const requestedSteps = Number(body.steps);
    const steps = Number.isFinite(requestedSteps)
      ? Math.max(10, Math.min(40, Math.round(requestedSteps)))
      : 28;

    const seed = Number.isFinite(Number(body.seed))
      ? Math.round(Number(body.seed))
      : Math.floor(Math.random() * 2147483647);

    const client = await Promise.race([
      Client.connect("multimodalart/minimax-h3"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MiniMax H3 Space не отвечает за 20 секунд")), 20000)
      )
    ]);

    const job = client.submit("/generate", [
      prompt,
      inputImage,
      null,
      canvas,
      duration,
      steps,
      seed,
      false
    ]);

    let resultData = null;
    let lastStatus = "";

    for await (const message of job) {
      if (message.type === "status") {
        lastStatus = String(message.stage || "");
        if (message.stage === "error") {
          throw new Error(message.message || "MiniMax H3 завершил запрос с ошибкой");
        }
      } else if (message.type === "data") {
        resultData = message.data;
      }
    }

    const findVideoUrl = (value, seen = new Set()) => {
      if (value == null) return "";
      if (typeof value === "string") {
        return /^https?:\/\//i.test(value) && /\.(mp4|webm)(?:$|[?#])/i.test(value)
          ? value
          : "";
      }
      if (typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);

      for (const key of ["url","videoUrl","video_url","path","file","data","value"]) {
        const found = findVideoUrl(value[key], seen);
        if (found) return found;
      }
      for (const key of Object.keys(value)) {
        const found = findVideoUrl(value[key], seen);
        if (found) return found;
      }
      return "";
    };

    const videoUrl = findVideoUrl(resultData);
    if (!videoUrl) {
      throw new Error(
        "MiniMax H3 не вернул доступный MP4" +
        (lastStatus ? " (" + lastStatus + ")" : "")
      );
    }

    return res.status(200).json({
      ok:true,
      mode:"video",
      provider:"Hugging Face ZeroGPU",
      model:"MiniMax H3",
      videoUrl,
      meta:{
        free:true,
        space:"multimodalart/minimax-h3",
        canvas,
        duration,
        steps,
        imageToVideo:Boolean(sourceBase64)
      }
    });
  } catch (error) {
    const message = String(error?.message || "MiniMax H3 request failed");
    console.warn("Miya MiniMax H3:", message);
    return res.status(502).json({
      ok:false,
      error:"MINIMAX_H3_FAILED",
      message,
      provider:"Hugging Face ZeroGPU"
    });
  }
}

module.exports = handler;
