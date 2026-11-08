import { createClient } from '../_shared/supabase.js';
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({ok:false},{status:405});
 const url=Deno.env.get('SUPABASE_URL')!;
 const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token)return Response.json({ok:false},{status:401});
 const auth=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user?.email)return Response.json({ok:false},{status:401});
 let password:string;
 try{password=(await req.json()).password;if(typeof password!=='string'||password.length>1024)throw Error();}catch{return Response.json({ok:false},{status:400});}
 const {data:verified,error:verifyError}=await auth.auth.signInWithPassword({email:user.email,password});
 password='';
 if(verifyError||verified.user?.id!==user.id)return Response.json({ok:false},{status:401});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const lock=await admin.rpc('lock_account_deletion',{p_verified_user:user.id});if(lock.error)throw Error();
  // Always delete page zero: successful removals shrink the listing. Include nested folders.
  async function clear(prefix:string):Promise<void>{
   for(;;){const {data,error}=await admin.storage.from('user-media').list(prefix,{limit:100});if(error)throw Error();if(!data?.length)return;
    const files:string[]=[];for(const obj of data){const path=`${prefix}/${obj.name}`;if(obj.id)files.push(path);else await clear(path);}
    if(files.length){const {error}=await admin.storage.from('user-media').remove(files);if(error)throw Error();}
    if(!files.length&&data.every(o=>!o.id))return;
   }
  }
  await clear(user.id);
  const {error}=await admin.auth.admin.deleteUser(user.id);if(error)throw Error();
  return Response.json({ok:true});
 }catch{return Response.json({ok:false,code:'DELETE_RETRY_REQUIRED'},{status:503});}
});
