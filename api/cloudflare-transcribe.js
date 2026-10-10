export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  const token=process.env.CLOUDFLARE_API_TOKEN;
  const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
  if(!token||!accountId)return res.status(500).json({error:"CLOUDFLARE_NOT_CONFIGURED"});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):(req.body||{});
    const audioData=String(body.audio||"").trim();
    if(!audioData)return res.status(400).json({error:"AUDIO_REQUIRED"});
    const comma=audioData.indexOf(",");
    if(!audioData.startsWith("data:")||comma<0)return res.status(400).json({error:"INVALID_AUDIO_DATA_URL"});
    const base64=audioData.slice(comma+1);
    if(!base64)return res.status(400).json({error:"INVALID_AUDIO_DATA_URL"});
    const upstream=await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/openai/whisper-large-v3-turbo`,
      {
        method:"POST",
        headers:{
          "Authorization":`Bearer ${token}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({audio:base64,language:String(body.language||"ru"),task:"transcribe"})
      }
    );
    const data=await upstream.json().catch(()=>null);
    if(!upstream.ok){
      console.error("Cloudflare Workers AI STT failed",upstream.status,data);
      return res.status(upstream.status).json({error:"CLOUDFLARE_STT_FAILED",details:data?.errors||data?.error||null});
    }
    const text=String(data?.result?.text||"").trim();
    if(!text)return res.status(422).json({error:"TRANSCRIPT_EMPTY"});
    return res.status(200).json({text,language:String(body.language||"ru"),model:"@cf/openai/whisper-large-v3-turbo"});
  }catch(error){
    console.error("Cloudflare Workers AI STT exception",error);
    return res.status(500).json({error:"CLOUDFLARE_STT_EXCEPTION"});
  }
}
