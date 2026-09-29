module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="GET"&&req.method!=="POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING"});
  try{
    const body=typeof req.body==="string"?(JSON.parse(req.body||"{}")):(req.body||{});
    const videoId=String(req.query?.video_id||body.video_id||"").trim();
    const model=String(req.query?.model||body.model||"").trim();
    if(!videoId) return res.status(400).json({ok:false,error:"VIDEO_ID_REQUIRED"});
    const url="https://apihub.agnes-ai.com/agnesapi?video_id="+encodeURIComponent(videoId)+(model?"&model_name="+encodeURIComponent(model):"");
    const upstream=await fetch(url,{headers:{"Authorization":"Bearer "+key,"Accept":"application/json"},signal:AbortSignal.timeout(15000)});
    const raw=await upstream.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok) return res.status(upstream.status).json({ok:false,error:"AGNES_VIDEO_STATUS_FAILED",message:data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status),upstreamStatus:upstream.status});
    return res.status(200).json({ok:true,...data});
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"AGNES_VIDEO_STATUS_HANDLER_ERROR",message:e?.message||"Agnes status request failed"});
  }
};