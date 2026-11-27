import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
const app=express();
// Render runs behind a reverse proxy; trust the first proxy so rate limiting can read client IPs safely.
app.set('trust proxy',1);
app.use(helmet());
app.use(cors({origin:(process.env.CLIENT_ORIGIN||'http://localhost:5173').split(',')}));
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:60_000,limit:100,standardHeaders:true,legacyHeaders:false}));
const ready=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const admin=ready?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const anon=ready?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY):null;
const songSchema=z.object({title:z.string().min(1).max(180),artist:z.string().min(1).max(180),language:z.string().max(60).optional().default(''),country:z.string().max(80).optional().default(''),audio_url:z.string().url().optional().or(z.literal('')).default(''),cover_url:z.string().url().optional().or(z.literal('')).default(''),album:z.string().max(180).optional().default('')});
app.get('/api/health',async(_req,res)=>{let databaseConnected=false;if(ready){const {error}=await admin.from('songs').select('id').limit(1);databaseConnected=!error;}res.json({ok:true,service:'ARMAN GAANE API',databaseConfigured:ready,databaseConnected});});
async function auth(req,res,next){if(!ready)return res.status(503).json({error:'Configure Supabase server environment first'});const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Sign in required'});const {data,error}=await anon.auth.getUser(token);if(error||!data.user)return res.status(401).json({error:'Invalid or expired session'});req.user=data.user;req.token=token;next()}
async function roles(req,res,next){const {data,error}=await admin.from('profiles').select('role,suspended').eq('id',req.user.id).single();if(error||!data||data.suspended)return res.status(403).json({error:'Account not authorized'});req.role=data.role;next()}
const permit=(...allowed)=>(req,res,next)=>allowed.includes(req.role)?next():res.status(403).json({error:'Insufficient permissions'});
const accountSchema=z.object({name:z.string().trim().min(2).max(80),age:z.number().int().min(13).max(120).optional().nullable(),gender:z.enum(['male','female','non_binary','prefer_not_to_say']).optional().nullable(),username:z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/),password:z.string().min(8).max(72)});
app.post('/api/auth/signup',rateLimit({windowMs:3600000,limit:5,standardHeaders:true,legacyHeaders:false}),async(req,res)=>{if(!ready)return res.status(503).json({error:'Authentication service is not configured'});const parsed=accountSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Check your details. Username must be 3–20 letters, numbers or underscores; password must be at least 8 characters.'});const {name,age,gender,username,password}=parsed.data;const {data:existing,error:lookupError}=await admin.from('profiles').select('id').ilike('username',username).limit(1);if(lookupError)return res.status(500).json({error:'Could not verify username'});if(existing?.length)return res.status(409).json({error:'That username is already taken'});const email=username+'@accounts.arman-gaane.invalid';const {error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name,username,age:age??null,gender:gender??null}});if(error)return res.status(400).json({error:error.message.includes('already')?'That username is already registered':'Could not create account. Please try another username.'});res.status(201).json({ok:true,message:'Account created. You can now sign in with your username.'});});
app.get('/api/me',auth,roles,(req,res)=>res.json({id:req.user.id,email:req.user.email,role:req.role}));
app.get('/api/songs',async(req,res)=>{if(!ready)return res.status(503).json({error:'Database not configured'});const q=String(req.query.q||'').slice(0,100);let query=admin.from('songs').select('id,title,artist,album,language,country,duration_seconds,cover_url,audio_url').eq('published',true).eq('rights_status','cleared').eq('is_blocked',false).eq('is_deleted',false).limit(40);if(q)query=query.or(`title.ilike.%${q}%,artist.ilike.%${q}%,language.ilike.%${q}%,country.ilike.%${q}%`);const {data,error}=await query;if(error)return res.status(500).json({error:'Song search failed'});res.json({items:data})});
// Public catalogue search: iTunes provides short preview URLs where available; obey provider terms and territories.
app.get('/api/search',auth,roles,async(req,res)=>{const q=String(req.query.q||'').trim().slice(0,100);if(!q)return res.json({items:[]});try{const u=new URL('https://itunes.apple.com/search');u.searchParams.set('term',q);u.searchParams.set('entity','song');u.searchParams.set('limit','24');const r=await fetch(u,{headers:{'User-Agent':'ArmanGaane/1.0'}});if(!r.ok)throw new Error('provider unavailable');const d=await r.json();res.json({items:(d.results||[]).map(x=>({trackId:x.trackId,title:x.trackName,artist:x.artistName,album:x.collectionName,language:'',country:x.country,artworkUrl100:x.artworkUrl100,audio_url:x.previewUrl||'',duration:x.trackTimeMillis?Math.round(x.trackTimeMillis/1000):null,provider:'Apple iTunes preview'}))})}catch{res.status(502).json({error:'Music catalogue search is temporarily unavailable'})}});
app.get('/api/admin/songs',auth,roles,permit('super_admin','music_manager','content_manager'),async(_req,res)=>{const {data,error}=await admin.from('songs').select('*').order('created_at',{ascending:false}).limit(200);if(error)return res.status(500).json({error:'Could not load songs'});res.json({items:data})});
app.post('/api/admin/songs',auth,roles,permit('super_admin','music_manager','content_manager'),async(req,res)=>{const parsed=songSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid song details'});const {data,error}=await admin.from('songs').insert({...parsed.data,created_by:req.user.id,rights_status:'pending',published:false,provider:'original_upload'}).select().single();if(error)return res.status(500).json({error:'Could not save song'});await admin.from('admin_audit_logs').insert({actor_id:req.user.id,action:'song.create',target_type:'song',target_id:data.id});res.status(201).json({item:data})});
app.patch('/api/admin/songs/:id',auth,roles,permit('super_admin','music_manager','content_manager'),async(req,res)=>{const allowed=z.object({title:z.string().min(1).max(180).optional(),artist:z.string().min(1).max(180).optional(),rights_status:z.enum(['pending','cleared','rejected']).optional(),published:z.boolean().optional(),is_blocked:z.boolean().optional(),is_deleted:z.boolean().optional(),moderation_note:z.string().max(500).optional(),language:z.string().max(60).optional(),country:z.string().max(80).optional()}).safeParse(req.body);if(!allowed.success)return res.status(400).json({error:'Invalid update'});if(allowed.data.published===true&&allowed.data.rights_status!=='cleared'){const {data:song}=await admin.from('songs').select('rights_status').eq('id',req.params.id).single();if(song?.rights_status!=='cleared')return res.status(400).json({error:'Rights must be cleared before publishing'})}const {data,error}=await admin.from('songs').update(allowed.data).eq('id',req.params.id).select().single();if(error)return res.status(500).json({error:'Could not update song'});await admin.from('admin_audit_logs').insert({actor_id:req.user.id,action:'song.update',target_type:'song',target_id:req.params.id,details:allowed.data});res.json({item:data})});
app.delete('/api/admin/songs/:id',auth,roles,permit('super_admin','music_manager'),async(req,res)=>{const {error}=await admin.from('songs').delete().eq('id',req.params.id);if(error)return res.status(500).json({error:'Could not delete song'});await admin.from('admin_audit_logs').insert({actor_id:req.user.id,action:'song.delete',target_type:'song',target_id:req.params.id});res.json({ok:true})});

const superOnly=permit('super_admin');
app.get('/api/admin/overview',auth,roles,superOnly,async(_req,res)=>{
 const [users,songs,plays,pending,banned,blocked]=await Promise.all([
  admin.from('profiles').select('id',{count:'exact',head:true}),
  admin.from('songs').select('id',{count:'exact',head:true}),
  admin.from('play_events').select('id',{count:'exact',head:true}),
  admin.from('songs').select('id',{count:'exact',head:true}).eq('rights_status','pending'),
  admin.from('profiles').select('id',{count:'exact',head:true}).eq('suspended',true),
  admin.from('songs').select('id',{count:'exact',head:true}).eq('is_blocked',true)
 ]);
 res.json({users:users.count||0,songs:songs.count||0,plays:plays.count||0,pendingSongs:pending.count||0,bannedUsers:banned.count||0,blockedSongs:blocked.count||0});
});
app.get('/api/admin/users',auth,roles,superOnly,async(req,res)=>{
 const page=Math.max(1,Number(req.query.page)||1),perPage=50;
 const {data,error}=await admin.auth.admin.listUsers({page,perPage});
 if(error)return res.status(500).json({error:'Could not load users'});
 const ids=(data.users||[]).map(u=>u.id);
 const {data:profiles}=ids.length?await admin.from('profiles').select('id,display_name,username,role,suspended,created_at').in('id',ids):{data:[]};
 const map=new Map((profiles||[]).map(p=>[p.id,p]));
 res.json({items:(data.users||[]).map(u=>({id:u.id,email:u.email,created_at:u.created_at,last_sign_in_at:u.last_sign_in_at,...(map.get(u.id)||{})}))});
});
app.patch('/api/admin/users/:id',auth,roles,superOnly,async(req,res)=>{
 if(req.params.id===req.user.id)return res.status(400).json({error:'You cannot suspend or change your own role'});
 const parsed=z.object({suspended:z.boolean().optional(),role:z.enum(['user','music_manager','content_manager','support_admin','super_admin']).optional()}).strict().safeParse(req.body);
 if(!parsed.success||!Object.keys(parsed.data).length)return res.status(400).json({error:'Invalid user update'});
 const {data,error}=await admin.from('profiles').update(parsed.data).eq('id',req.params.id).select('id,role,suspended').single();
 if(error)return res.status(500).json({error:'Could not update user'});
 await admin.from('admin_audit_logs').insert({actor_id:req.user.id,action:'user.update',target_type:'user',target_id:req.params.id,details:parsed.data});
 res.json({item:data});
});
app.get('/api/admin/settings',auth,roles,superOnly,async(_req,res)=>{
 const {data,error}=await admin.from('site_settings').select('key,value,updated_at').order('key');
 if(error)return res.status(500).json({error:'Could not load settings'});
 res.json({items:data});
});
app.put('/api/admin/settings/:key',auth,roles,superOnly,async(req,res)=>{
 const key=String(req.params.key||'').slice(0,80);
 const parsed=z.object({value:z.unknown()}).safeParse(req.body);
 if(!/^[a-z0-9_.-]+$/i.test(key)||!parsed.success)return res.status(400).json({error:'Invalid setting'});
 const {data,error}=await admin.from('site_settings').upsert({key,value:parsed.data.value,updated_by:req.user.id,updated_at:new Date().toISOString()}).select().single();
 if(error)return res.status(500).json({error:'Could not save setting'});
 await admin.from('admin_audit_logs').insert({actor_id:req.user.id,action:'settings.update',target_type:'setting',target_id:key});
 res.json({item:data});
});
app.get('/api/admin/audit',auth,roles,superOnly,async(_req,res)=>{
 const {data,error}=await admin.from('admin_audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
 if(error)return res.status(500).json({error:'Could not load audit log'});
 res.json({items:data});
});

app.listen(process.env.PORT||4000,'0.0.0.0',()=>console.log('ARMAN GAANE API listening'));
