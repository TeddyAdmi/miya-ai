export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({success:false,error:"METHOD_NOT_ALLOWED"});
 try{
  const body=req.body&&typeof req.body==="object"?req.body:{},prompt=String(body.prompt||"").trim().slice(0,512);
  if(!prompt&&!body.image)return res.status(400).json({success:false,error:"PROMPT_OR_IMAGE_REQUIRED"});
  const home=await fetch("https://freeaivideo.org/",{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"}});
  if(!home.ok)throw new Error("FREEAIVIDEO_HOME_"+home.status);
  const html=await home.text();
  const m=html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)||html.match(/name=["']_token["'][^>]+value=["']([^"']+)["']/i),token=m?.[1]||"";
  if(!token)throw new Error("FREEAIVIDEO_CSRF_NOT_FOUND");
  const cookies=typeof home.headers.getSetCookie==="function"?home.headers.getSetCookie():[];
  const cookieHeader=cookies.map(v=>v.split(";")[0]).join("; ");
  const form=new FormData(),image=String(body.image||"");
  const hasImage=image.startsWith("data:image/")||/^https?:\/\//i.test(image);
  form.append("mode",hasImage?"image":"text");form.append("with_audio",body.with_audio===false?"0":"1");form.append("quality",String(body.quality||"speed"));form.append("size",String(body.size||"1920x1080"));form.append("fps",String(body.fps||30));form.append("_token",token);form.append("model","videox");form.append("prompt",prompt);
  if(hasImage){
   let blob;
   if(image.startsWith("data:image/")){
    const p=image.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s);if(!p)throw new Error("INVALID_IMAGE_DATA");
    blob=new Blob([Buffer.from(p[2],image.includes(";base64")?"base64":"utf8")],{type:p[1]||"image/jpeg"});
   }else{const ir=await fetch(image,{headers:{"User-Agent":"Mozilla/5.0","Accept":"image/*"}});if(!ir.ok)throw new Error("IMAGE_FETCH_"+ir.status);blob=await ir.blob()}
   form.append("image",blob,"miya-reference.jpg");
  }
  const up=await fetch("https://freeaivideo.org/ajax/ai-video",{method:"POST",headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json","X-Requested-With":"XMLHttpRequest","X-CSRF-TOKEN":token,...(cookieHeader?{"Cookie":cookieHeader}:{})},body:form});
  const text=await up.text();let data=null;try{data=JSON.parse(text)}catch{}
  if(!up.ok||!data?.success||!data?.data)return res.status(up.status||502).json({success:false,error:"UPSTREAM_ERROR",message:data?.message||text.slice(0,500),upstreamStatus:up.status});
  return res.status(200).json({success:true,videoUrl:String(data.data),withAudio:body.with_audio!==false,mode:hasImage?"image":"text",watermarked:/watermark/i.test(String(data.data))});
 }catch(e){return res.status(500).json({success:false,error:"FREEAIVIDEO_FAILED",message:String(e?.message||e)})}
}