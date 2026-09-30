module.exports = async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING"});
  try{
    const upstream=await fetch("https://apihub.agnes-ai.com/v1/videos",{
      method:"POST",
      headers:{Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({model:"agnes-video-2.5-flash",prompt:"A small red ball rolling slowly across a wooden table, realistic motion",mode:"text",seconds:"5",size:"720P",aspect_ratio:"16:9",n:1}),
      signal:AbortSignal.timeout(30000)
    });
    const raw=await upstream.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{}
    const retry=upstream.headers.get("retry-after");
    return res.status(upstream.status).json({
      ok:upstream.ok,
      upstreamStatus:upstream.status,
      model:"agnes-video-2.5-flash",
      retryAfter:retry?Number(retry):null,
      response:data?.error?.message||data?.message||data,
      requestId:data?.error?.request_id||data?.request_id||null
    });
  }catch(e){return res.status(502).json({ok:false,error:"AGNES_DIRECT_TEST_FAILED",message:e?.message||String(e)});}
};
