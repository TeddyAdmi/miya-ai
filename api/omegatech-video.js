export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const raw=String(req.query?.url||"");
    if(!raw||!/^https:\/\/sora\.aritek\.app\/generated\//i.test(raw)){
      return res.status(400).json({error:"Invalid OmegaTech video URL"});
    }
    const upstream=await fetch(raw);
    if(!upstream.ok){
      return res.status(upstream.status).json({error:"Upstream video request failed"});
    }
    const type=upstream.headers.get("content-type")||"video/mp4";
    const buffer=Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type",type);
    res.setHeader("Content-Length",String(buffer.length));
    res.setHeader("Cache-Control","public, max-age=14400");
    return res.status(200).send(buffer);
  }catch(error){
    return res.status(500).json({error:String(error?.message||error||"OmegaTech video proxy failed")});
  }
}