module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});

  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING",message:"Добавьте AGNES_API_KEY в Vercel Environment Variables."});

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(!prompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});

    const model=String(body.model||"agnes-video-2.5").trim();
    const allowedModels=["agnes-video-2.5","agnes-video-2.5-flash","agnes-video-v2.0"];
    if(!allowedModels.includes(model)) return res.status(400).json({ok:false,error:"AGNES_VIDEO_MODEL_UNSUPPORTED"});

    const ratio=["16:9","9:16","1:1","4:3","3:4","21:9"].includes(String(body.aspect_ratio))?String(body.aspect_ratio):"16:9";
    const seconds=Math.max(4,Math.min(12,Number(body.seconds)||12));
    const payload={model,prompt,n:1};

    if(model==="agnes-video-v2.0"){
      const dims={ "16:9":[1152,648], "9:16":[704,1280], "1:1":[1024,1024], "4:3":[1088,832], "3:4":[832,1088], "21:9":[1344,576] };
      const [width,height]=dims[ratio]||dims["16:9"];
      payload.width=width; payload.height=height; payload.num_frames=Math.round(seconds*24); payload.frame_rate=24;
    }else{
      payload.mode=body.first_frame?"img2video":"text";
      payload.seconds=String(seconds);
      payload.size=model==="agnes-video-2.5-flash"?"720P":(String(body.size||"2K"));
      if(!["720P","1080P","1K","2K"].includes(payload.size)) payload.size="2K";
      payload.aspect_ratio=ratio;
      if(body.seed!==undefined && Number.isFinite(Number(body.seed))) payload.seed=Number(body.seed);
      if(body.first_frame) payload.first_frame=String(body.first_frame);
      if(body.last_frame) payload.last_frame=String(body.last_frame);
      if(Array.isArray(body.images)&&body.images.length) { payload.mode="reference"; payload.images=body.images.slice(0,8); }
    }

    const upstream=await fetch("https://apihub.agnes-ai.com/v1/videos",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(55000)
    });
    const raw=await upstream.text();
    let data={}; try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok) return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({ok:false,error:"AGNES_VIDEO_CREATE_FAILED",message:data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status),upstreamStatus:upstream.status});

    return res.status(200).json({
      ok:true, provider:"Agnes", model:data.model||model,
      taskId:data.task_id||data.id||null, videoId:data.video_id||null,
      status:data.status||"queued", progress:Number(data.progress)||0,
      seconds:data.seconds||String(seconds), size:data.size||payload.size||null
    });
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"AGNES_VIDEO_HANDLER_ERROR",message:e?.message||"Agnes video request failed"});
  }
};