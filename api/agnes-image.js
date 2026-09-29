module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
  const key=process.env.AGNES_API_KEY;
  if(!key) return res.status(500).json({ok:false,error:"AGNES_API_KEY_MISSING",message:"Добавьте AGNES_API_KEY в Vercel Environment Variables."});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(!prompt) return res.status(400).json({ok:false,error:"PROMPT_REQUIRED"});
    const ratio=["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"].includes(String(body.ratio))?String(body.ratio):"16:9";
    const n=Math.max(1,Math.min(4,Number(body.n)||1));
    const payload={model:"agnes-image-2.5-flash",prompt,n,size:"4K",ratio,extra_body:{response_format:"url"}};
    const images=[];
    const source=String(body.imageBase64||body.imageUrl||"").trim();
    if(source) payload.extra_body.image=[source];

    const upstream=await fetch("https://apihub.agnes-ai.com/v1/images/generations",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(55000)
    });
    const raw=await upstream.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok) return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({ok:false,error:"AGNES_IMAGE_FAILED",message:data?.error?.message||data?.message||raw||("Agnes HTTP "+upstream.status),upstreamStatus:upstream.status});
    const urls=Array.isArray(data?.data)?data.data.map(x=>x?.url).filter(x=>typeof x==="string"&&/^https?:\/\//i.test(x)):[];
    if(!urls.length) return res.status(502).json({ok:false,error:"AGNES_IMAGE_URL_MISSING",providerResponse:data});
    return res.status(200).json({ok:true,mode:"image",status:"completed",provider:"Agnes",model:"Agnes Image 2.5 Flash · 4K",imageUrl:urls[0],imageUrls:urls,count:urls.length,meta:{freeCandidate:true,size:"4K",ratio,edit:Boolean(source)}});
  }catch(e){
    return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"AGNES_IMAGE_HANDLER_ERROR",message:e?.message||"Agnes image request failed"});
  }
};