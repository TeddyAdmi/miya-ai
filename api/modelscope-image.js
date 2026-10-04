const API_BASE = "https://api-inference.modelscope.cn/";
const MODEL = "Tongyi-MAI/Z-Image-Turbo";

function json(res,status,body){
  res.status(status).setHeader("Content-Type","application/json; charset=utf-8").send(JSON.stringify(body));
}

function isAllowedImageHost(host){
  const h=String(host||"").toLowerCase();
  return h==="modelscope.cn" ||
    h.endsWith(".modelscope.cn") ||
    h==="modelscope-oss.oss-cn-beijing.aliyuncs.com" ||
    h.endsWith(".oss-cn-beijing.aliyuncs.com") ||
    h.endsWith(".aliyuncs.com");
}

export default async function handler(req,res){
  if(req.method==="GET"){
    try{
      const raw=String(req.query?.url||"").trim();
      if(!raw)return json(res,400,{ok:false,error:"Image URL is required"});
      const target=new URL(raw);
      if(target.protocol!=="https:"||!isAllowedImageHost(target.hostname)){
        return json(res,400,{ok:false,error:"Image URL host is not allowed"});
      }
      const upstream=await fetch(target.toString(),{cache:"no-store"});
      if(!upstream.ok)return json(res,upstream.status,{ok:false,error:"Image proxy failed",upstreamStatus:upstream.status});
      const type=upstream.headers.get("content-type")||"image/jpeg";
      if(!/^image\//i.test(type))return json(res,502,{ok:false,error:"Upstream is not an image"});
      res.setHeader("Content-Type",type);
      res.setHeader("Cache-Control","public, max-age=86400");
      const length=upstream.headers.get("content-length");
      if(length)res.setHeader("Content-Length",length);
      return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
    }catch(error){
      return json(res,500,{ok:false,error:String(error?.message||error||"ModelScope image proxy failed")});
    }
  }

  if(req.method!=="POST"){
    res.setHeader("Allow","GET, POST");
    return json(res,405,{ok:false,error:"Method not allowed"});
  }

  try{
    const token=String(process.env.MODELSCOPE_TOKEN||"").trim();
    if(!token)return json(res,500,{ok:false,error:"MODELSCOPE_TOKEN is not configured"});

    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const prompt=String(body.prompt||"").trim();
    if(!prompt)return json(res,400,{ok:false,error:"Prompt is required"});
    if(body.imageBase64||body.imageUrl){
      return json(res,400,{ok:false,error:"ModelScope test currently supports text-to-image only"});
    }

    const response=await fetch(API_BASE+"v1/images/generations",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "X-ModelScope-Async-Mode":"true"
      },
      body:JSON.stringify({
        model:MODEL,
        prompt:prompt.slice(0,4000)
      })
    });

    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    if(!response.ok){
      return json(res,response.status,{ok:false,error:"ModelScope generation request failed",message:String(data?.message||data?.error||raw).slice(0,1200),upstreamStatus:response.status});
    }

    let imageUrl="";
    if(Array.isArray(data?.output_images)&&data.output_images[0])imageUrl=String(data.output_images[0]);
    if(Array.isArray(data?.images)&&data.images[0]?.url)imageUrl=String(data.images[0].url);
    if(data?.image_url)imageUrl=String(data.image_url);

    const taskId=String(data?.task_id||"").trim();
    if(!imageUrl&&!taskId){
      return json(res,502,{ok:false,error:"ModelScope returned neither image URL nor task_id",raw:data});
    }

    if(taskId){
      const deadline=Date.now()+180000;
      while(Date.now()<deadline){
        await new Promise(r=>setTimeout(r,2500));
        const statusResponse=await fetch(API_BASE+"v1/tasks/"+encodeURIComponent(taskId),{
          headers:{
            "Authorization":"Bearer "+token,
            "X-ModelScope-Task-Type":"image_generation"
          },
          cache:"no-store"
        });
        const statusRaw=await statusResponse.text();
        let statusData={};
        try{statusData=statusRaw?JSON.parse(statusRaw):{}}catch{}
        const state=String(statusData?.task_status||"").toUpperCase();
        if(state==="SUCCEED"||state==="SUCCESS"||state==="COMPLETED"){
          imageUrl=String(statusData?.output_images?.[0]||statusData?.images?.[0]?.url||statusData?.image_url||"");
          if(imageUrl)break;
        }
        if(state==="FAILED"||state==="ERROR"){
          return json(res,502,{ok:false,error:"ModelScope image generation failed",message:String(statusData?.message||statusData?.error||"Task failed").slice(0,1200),taskId});
        }
      }
    }

    if(!imageUrl)return json(res,504,{ok:false,error:"ModelScope image generation timed out",taskId});
    return json(res,200,{
      ok:true,
      model:MODEL,
      taskId:taskId||null,
      imageUrl:"/api/modelscope-image?url="+encodeURIComponent(imageUrl)
    });
  }catch(error){
    return json(res,500,{ok:false,error:"MODELSCOPE_IMAGE_FAILED",message:String(error?.message||error||"ModelScope request failed").slice(0,1200)});
  }
}
