const { Readable } = require("stream");

module.exports = async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Range,Content-Type");
  res.setHeader("Cache-Control","public, max-age=3600");

  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="GET"&&req.method!=="HEAD") return res.status(405).end();

  try{
    const raw=String(req.query?.url||"").trim();
    if(!raw) return res.status(400).json({ok:false,error:"VIDEO_URL_REQUIRED"});

    let target;
    try{ target=new URL(raw); }catch{
      return res.status(400).json({ok:false,error:"VIDEO_URL_INVALID"});
    }

    const host=target.hostname.toLowerCase();
    const allowed=host==="cos-platform-outputs.agnes-ai.cn"||
      host.endsWith(".agnes-ai.cn")||
      host.endsWith(".agnes-ai.space")||
      host==="ahm7xmakki.com";
    if(target.protocol!=="https:"||!allowed){
      return res.status(403).json({ok:false,error:"VIDEO_HOST_NOT_ALLOWED"});
    }

    const headers={};
    const range=req.headers.range;
    if(range) headers.Range=range;

    const upstream=await fetch(target.toString(),{
      method:req.method,
      headers,
      redirect:"follow",
      signal:AbortSignal.timeout(290000)
    });

    res.statusCode=upstream.status;
    for(const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]){
      const value=upstream.headers.get(name);
      if(value)res.setHeader(name,value);
    }
    if(!res.getHeader("Content-Type"))res.setHeader("Content-Type","video/mp4");

    if(req.method==="HEAD"||!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  }catch(e){
    if(!res.headersSent)return res.status(502).json({ok:false,error:"VIDEO_PROXY_FAILED",message:String(e?.message||"Video proxy failed").slice(0,500)});
    res.end();
  }
};
