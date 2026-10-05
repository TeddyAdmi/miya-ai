module.exports = async function handler(req,res){
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type,Accept");
 if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({ok:false,error:"METHOD_NOT_ALLOWED"});
 try{
  const body=req.body||{},dataUrl=String(body.base64||"").trim();if(!dataUrl.startsWith("data:image/"))return res.status(400).json({ok:false,error:"IMAGE_REQUIRED"});
  const match=dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);if(!match)return res.status(400).json({ok:false,error:"INVALID_IMAGE_DATA"});
  const mime=String(match[1]||"image/jpeg").toLowerCase(),buffer=Buffer.from(match[2],"base64");if(!buffer.length)return res.status(400).json({ok:false,error:"EMPTY_IMAGE"});if(buffer.length>20*1024*1024)return res.status(413).json({ok:false,error:"IMAGE_TOO_LARGE"});
  const form=new FormData();form.append("file",new Blob([buffer],{type:mime}),String(body.name||"miya-image.jpg"));
  const upstream=await fetch("https://cleverutils.com/api/v1/tools/image-to-text",{method:"POST",body:form,headers:{Accept:"application/json"},signal:AbortSignal.timeout(80000)});
  const raw=await upstream.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
  if(!upstream.ok)return res.status(upstream.status).json({ok:false,error:data?.error?.code||data?.error||"OCR_UPSTREAM_ERROR",message:data?.error?.message||data?.message||raw||("CleverUtils HTTP "+upstream.status)});
  return res.status(200).json({ok:true,text:String(data?.text??data?.data?.text??"")});
 }catch(e){return res.status(e?.name==="TimeoutError"?504:502).json({ok:false,error:"OCR_PROXY_ERROR",message:e?.message||"Не удалось выполнить OCR"})}
};
module.exports.config={maxDuration:90};
