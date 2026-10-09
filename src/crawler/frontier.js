import fs from 'node:fs/promises';
import path from 'node:path';
import {canonicalUrlKey,isPublicHttpUrl} from '../core/url.js';

export class CrawlFrontier {
  constructor(file){this.file=file;this.items=new Map();this.ready=false;}
  async init(){if(this.ready)return;await fs.mkdir(path.dirname(this.file),{recursive:true});try{const raw=await fs.readFile(this.file,'utf8');for(const item of JSON.parse(raw))this.items.set(item.key,item);}catch(e){if(e.code!=='ENOENT')throw e;}this.ready=true;}
  async enqueue(url,{depth=0,priority=0,discoveredBy=null,nextCrawlAt=null}={}){await this.init();if(!isPublicHttpUrl(url))return false;const key=canonicalUrlKey(url);if(!key)return false;const old=this.items.get(key);const item=old||{key,url:canonicalUrlKey(url),depth,priority,status:'queued',attempts:0,createdAt:new Date().toISOString()};item.url=url;if(depth<item.depth)item.depth=depth;item.priority=Math.max(item.priority||0,priority);if(discoveredBy)item.discoveredBy=discoveredBy;if(nextCrawlAt!==null)item.nextCrawlAt=nextCrawlAt;item.status=item.status==='done'?'queued':item.status;this.items.set(key,item);return true;}
  async claim(limit=10,now=Date.now()){await this.init();const eligible=[...this.items.values()].filter(x=>x.status==='queued'||(x.status==='done'&&x.nextCrawlAt&&Date.parse(x.nextCrawlAt)<=now)||x.status==='retry').sort((a,b)=>(b.priority-a.priority)||(Date.parse(a.nextCrawlAt||0)-Date.parse(b.nextCrawlAt||0))).slice(0,limit);for(const x of eligible){x.status='crawling';x.lastAttemptAt=new Date(now).toISOString();x.attempts=(x.attempts||0)+1;}return eligible;}
  complete(key,{nextCrawlAt=null,hash=null}={}){const x=this.items.get(key);if(!x)return;x.status='done';x.lastCrawledAt=new Date().toISOString();if(nextCrawlAt)x.nextCrawlAt=nextCrawlAt;if(hash)x.lastHash=hash;}
  fail(key,error,{retry=true,maxAttempts=3}={}){const x=this.items.get(key);if(!x)return;x.lastError=String(error||'Unknown error').slice(0,300);x.status=retry&&(x.attempts||0)<maxAttempts?'retry':'failed';if(x.status==='retry'){const delay=Math.min(3600000,Math.pow(2,Math.max(0,(x.attempts||1)-1))*5000);x.nextCrawlAt=new Date(Date.now()+delay).toISOString();}}
  get(key){return this.items.get(canonicalUrlKey(key));}
  stats(){const counts={};for(const x of this.items.values())counts[x.status]=(counts[x.status]||0)+1;return {urls:this.items.size,...counts};}
  async flush(){await this.init();const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify([...this.items.values()],null,2),'utf8');await fs.rename(tmp,this.file);}
}
