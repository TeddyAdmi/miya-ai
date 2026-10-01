export default async function handler(req,res){
  if(req.method!=="GET"&&req.method!=="HEAD"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const raw=String(req.query?.url||"");
    let target;
    try{ target=new URL(raw); }catch{
      return res.status(400).json({error:"Invalid OmegaTech video URL"});
    }

    const allowedHost=/^(?:sora|cdn|video|media)\.aritek\.app$/i.test(target.hostname);
    const allowedPath=target.hostname.toLowerCase()==="sora.aritek.app"
      ? target.pathname.startsWith("/generated/")
      : true;

    if(target.protocol!=="https:"||!allowedHost||!allowedPath){
      return res.status(400).json({error:"Invalid OmegaTech video URL"});
    }

    const probe=String(req.query?.probe||"") === "1";
    if(probe){
      let upstream;
      try{ upstream=await fetch(target.toString(),{method:"HEAD",cache:"no-store"}); }
      catch{
        upstream=await fetch(target.toString(),{headers:{"Range":"bytes=0-0"},cache:"no-store"});
      }
      if(!upstream.ok && upstream.status!==206){
        return res.status(upstream.status).json({error:"Upstream video is not ready",upstreamStatus:upstream.status});
      }
      res.setHeader("Cache-Control","no-store");
      return res.status(200).json({ok:true,ready:true,status:upstream.status});
    }

    const range=req.headers?.range;
    const upstreamHeaders={};
    if(range)upstreamHeaders.Range=String(range);
    const upstream=await fetch(target.toString(),{headers:upstreamHeaders,cache:"no-store"});
    if(!upstream.ok && upstream.status!==206){
      return res.status(upstream.status).json({error:"Upstream video request failed"});
    }

    const type=upstream.headers.get("content-type")||"video/mp4";
    const contentLength=upstream.headers.get("content-length");
    const contentRange=upstream.headers.get("content-range");
    const acceptRanges=upstream.headers.get("accept-ranges")||"bytes";
    res.setHeader("Content-Type",type);
    res.setHeader("Accept-Ranges",acceptRanges);
    if(contentLength)res.setHeader("Content-Length",contentLength);
    if(contentRange)res.setHeader("Content-Range",contentRange);
    res.setHeader("Cache-Control","public, max-age=14400");
    if(req.method==="HEAD")return res.status(upstream.status).end();
    const buffer=Buffer.from(await upstream.arrayBuffer());
    if(!contentLength)res.setHeader("Content-Length",String(buffer.length));
    return res.status(upstream.status).send(buffer);
  }catch(error){
    return res.status(500).json({error:String(error?.message||error||"OmegaTech video proxy failed")});
  }
}
