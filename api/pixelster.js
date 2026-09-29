async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  try{
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
    
    
  }catch(error){
    return res.status(502).json({ok:false,error:"PIXELSTER_FAILED",message:String(error?.message||"PixelSter request failed").slice(0,700)});
  }
}
module.exports=handler;
