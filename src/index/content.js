import {createHash} from 'node:crypto';
import {canonicalUrlKey} from '../core/url.js';

function decodeEntities(s){return s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));}
function textOf(html){return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function first(html,re){const m=html.match(re);return m?decodeEntities(m[1].replace(/<[^>]+>/g,' ').trim()):'';}
function links(html,base){const out=[];const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;let m;while((m=re.exec(html))&&out.length<500){try{const u=new URL(m[1],base);if(/^https?:$/.test(u.protocol))out.push(u.href)}catch{}}return [...new Set(out)];}
export function extractDocument(html,url){
  const title=first(html,/<title[^>]*>([\s\S]*?)<\/title>/i)||new URL(url).hostname;
  const description=first(html,/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)||first(html,/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const headings=[];let m;const hre=/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;while((m=hre.exec(html))&&headings.length<30)headings.push(textOf(m[1]));
  const body=textOf(html);const canonical=first(html,/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)||url;
  const doc={url,canonical:canonicalUrlKey(canonical),title:title.slice(0,300),description:description.slice(0,600),headings,content:body.slice(0,200000),links:links(html,url),wordCount:body?body.split(/\s+/).length:0};
  doc.hash=createHash('sha256').update(doc.content).digest('hex');
  doc.host=new URL(url).hostname.replace(/^www\./,'');
  doc.indexedAt=new Date().toISOString();
  return doc;
}
