module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});

  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING",message:"Добавьте AGNES_API_KEY в Vercel Environment Variables."});

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  async function createUpstream(payload){
    let last=null;
    for(let attempt=0;attempt<3;attempt++){
      const upstream=await fetch("https://apihub.agnes-ai.com/v1/videos",{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+key,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body:JSON.stringify(payload),
        signal:AbortSignal.timeout(18000)
      });
      const raw=await upstream.text();
      let data={};
      try{data=raw?JSON.parse(raw):{}}catch{}
      last={upstream,data,raw};

      const message=String(data?.error?.message||data?.message||raw||"");
      const queueFull=upstream.status===503&&/queue\s+is\s+full|queue_full|service\s+busy/i.test(message);
      if(queueFull&&attempt<2){
        await sleep(2500*(attempt+1));
        continue;
      }
      return last;
    }
    return last;
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(!prompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});

    const requestedModel=String(body.model||"agnes-video-2.5-flash").trim();
    const allowedModels=["agnes-video-2.5","agnes-video-2.5-flash","agnes-video-v2.0"];
    if(!allowedModels.includes(requestedModel)) return res.status(400).json({ok:false,error:"AGNES_VIDEO_MODEL_UNSUPPORTED"});

    const ratio=["16:9","9:16","1:1","4:3","3:4","21:9"].includes(String(body.aspect_ratio))
      ? String(body.aspect_ratio) : "16:9";
    const seconds=Math.max(4,Math.min(12,Number(body.seconds)||12));
    const source=body.first_frame?String(body.first_frame).trim():"";

    function buildPayload(model){
      const payload={model,prompt,n:1};

      if(model==="agnes-video-v2.0"){
        const dims={
          "16:9":[1152,648],
          "9:16":[704,1280],
          "1:1":[1024,1024],
          "4:3":[1088,832],
          "3:4":[832,1088],
          "21:9":[1344,576]
        };
        const [width,height]=dims[ratio]||dims["16:9"];
        // Agnes v2.0 requires 8n+1 frames. Keep 24 fps and choose the
        // nearest valid frame count for the requested 4–12 second duration.
        const targetFrames=Math.round(seconds*24);
        const numFrames=Math.max(9,Math.min(441,8*Math.round((targetFrames-1)/8)+1));
        payload.width=width;
        payload.height=height;
        payload.num_frames=numFrames;
        payload.frame_rate=24;
        if(source) payload.image=source;
        if(body.seed!==undefined&&Number.isFinite(Number(body.seed))) payload.seed=Number(body.seed);
        return payload;
      }

      payload.mode=source?"img2video":"text";
      payload.seconds=String(seconds);
      payload.size=model==="agnes-video-2.5-flash"
        ?"720P"
        :(String(body.size||"2K"));
      if(!["720P","1080P","1K","2K"].includes(payload.size)) payload.size="2K";
      payload.aspect_ratio=ratio;
      if(body.seed!==undefined&&Number.isFinite(Number(body.seed))) payload.seed=Number(body.seed);
      if(source) payload.first_frame=source;
      if(body.last_frame) payload.last_frame=String(body.last_frame);
      if(Array.isArray(body.images)&&body.images.length){
        payload.mode="reference";
        payload.images=body.images.slice(0,5);
      }
      return payload;
    }

    let actualModel=requestedModel;
    let fallbackFrom=null;
    let result=await createUpstream(buildPayload(requestedModel));

    // Agnes documents 503 as a busy/unavailable condition and recommends
    // retry/backoff. If the free Flash queue is still full, transparently
    // try the legacy v2.0 video endpoint instead of returning a misleading 502.
    if(
      requestedModel==="agnes-video-2.5-flash" &&
      result?.upstream?.status===503 &&
      /queue\s+is\s+full|queue_full|service\s+busy/i.test(
        String(result?.data?.error?.message||result?.data?.message||result?.raw||"")
      )
    ){
      fallbackFrom=requestedModel;
      actualModel="agnes-video-v2.0";
      result=await createUpstream(buildPayload(actualModel));
    }

    const upstream=result.upstream;
    const data=result.data;
    const raw=result.raw;

    if(!upstream.ok){
      const message=String(data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status)).slice(0,700);
      const status=upstream.status>=400&&upstream.status<600?upstream.status:502;
      return res.status(status).json({
        ok:false,
        error:"AGNES_VIDEO_CREATE_FAILED",
        message,
        upstreamStatus:upstream.status,
        model:actualModel,
        fallbackFrom
      });
    }

    return res.status(200).json({
      ok:true,
      provider:"Agnes",
      model:data.model||actualModel,
      requestedModel,
      fallbackFrom,
      taskId:data.task_id||data.id||null,
      videoId:data.video_id||null,
      status:data.status||"queued",
      progress:Number(data.progress)||0,
      seconds:data.seconds||String(seconds),
      size:data.size||null
    });
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({
      ok:false,
      error:"AGNES_VIDEO_HANDLER_ERROR",
      message:e?.message||"Agnes video request failed"
    });
  }
};
