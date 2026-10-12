import fs from 'node:fs';
import path from 'node:path';
import {canonicalUrlKey} from '../core/url.js';

export class DocumentStore{
  constructor(file){this.file=file;this.metaFile=file.replace(/\.json$/,'-meta.json');this.docs=new Map();this.inv=new Map();this.versions=new Map();this.graph=new Map();this.ready=false;}
  async init(){if(this.ready)return;await fs.promises.mkdir(path.dirname(this.file),{recursive:true});try{const raw=await fs.promises.readFile(this.file,'utf8');for(const d of JSON.parse(raw)){const key=d.canonical||canonicalUrlKey(d.url);d.canonical=key;this.docs.set(key,d);this.#addInv(d);}}catch(e){if(e.code!=='ENOENT')throw e;}try{const meta=JSON.parse(await fs.promises.readFile(this.metaFile,'utf8'));for(const [k,v] of Object.entries(meta.versions||{}))this.versions.set(k,v);for(const [k,v] of Object.entries(meta.graph||{}))this.graph.set(k,new Set(v));}catch(e){if(e.code!=='ENOENT')throw e;}this.ready=true;}
  #tokens(text){return (String(text||'').toLowerCase().match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*(?:\+\+|#)?/gu)||[]).flatMap(t=>[t,...t.split(/[._-]/).filter(p=>p&&p!==t&&/\p{L}/u.test(p))]);}
  #addInv(d){for(const t of new Set(this.#tokens(`${d.title||''} ${d.description||''} ${d.headings?.join(' ')||''} ${d.content||''}`))){let set=this.inv.get(t);if(!set){set=new Set();this.inv.set(t,set)}set.add(d.canonical);}}
  #removeInv(d){for(const [t,set] of this.inv){set.delete(d.canonical);if(!set.size)this.inv.delete(t)}}
  async upsert(doc){await this.init();const key=canonicalUrlKey(doc.canonical)||canonicalUrlKey(doc.url);const old=this.docs.get(key);if(old&&old.hash&&doc.hash&&old.hash===doc.hash){old.lastSeenAt=new Date().toISOString();this.docs.set(key,old);return {changed:false,doc:old};}if(old)this.#removeInv(old);doc.canonical=key;doc.version=(old?.version||0)+1;doc.firstIndexedAt=old?.firstIndexedAt||new Date().toISOString();doc.indexedAt=doc.indexedAt||new Date().toISOString();doc.lastChangedAt=new Date().toISOString();this.docs.set(key,doc);this.#addInv(doc);const history=this.versions.get(key)||[];history.push({version:doc.version,hash:doc.hash,indexedAt:doc.indexedAt,wordCount:doc.wordCount,title:doc.title});this.versions.set(key,history.slice(-10));const outgoing=new Set((doc.links||[]).map(canonicalUrlKey).filter(Boolean));this.graph.set(key,outgoing);return {changed:true,doc};}
  #key(key){if(this.docs.has(key))return key;try{return canonicalUrlKey(key);}catch{return null;}}
  get(key){const resolved=this.#key(key);return resolved?this.docs.get(resolved):undefined;}
  candidates(terms){const sets=(terms||[]).map(t=>this.inv.get(String(t).toLowerCase())||new Set());const union=new Set();for(const s of sets)for(const k of s)union.add(k);return [...union].map(k=>this.docs.get(k)).filter(Boolean)}
  linksFrom(key){const resolved=this.#key(key);return [...(resolved?this.graph.get(resolved)||[]:[])];}
  versionsOf(key){const resolved=this.#key(key);return resolved?this.versions.get(resolved)||[]:[];}
  documentFrequency(term){return this.inv.get(String(term).toLowerCase())?.size||0;}
  documentCount(){return this.docs.size;}
  lengthOf(doc){return Number(doc?.wordCount)||this.#tokens(`${doc?.title||''} ${doc?.description||''} ${doc?.headings?.join(' ')||''} ${doc?.content||''}`).length||0;}
  averageLength(){if(!this.docs.size)return 0;let total=0;for(const doc of this.docs.values())total+=this.lengthOf(doc);return total/this.docs.size;}
  stats(){let words=0;for(const d of this.docs.values())words+=this.lengthOf(d);let edges=0;for(const s of this.graph.values())edges+=s.size;return {documents:this.docs.size,terms:this.inv.size,words,links:edges,versionedDocuments:[...this.versions.values()].filter(x=>x.length>1).length};}
  async flush(){await this.init();const tmp=`${this.file}.tmp`;await fs.promises.writeFile(tmp,JSON.stringify([...this.docs.values()]),'utf8');await fs.promises.rename(tmp,this.file);const meta={versions:Object.fromEntries(this.versions),graph:Object.fromEntries([...this.graph].map(([k,v])=>[k,[...v]]))};const mt=this.metaFile+'.tmp';await fs.promises.writeFile(mt,JSON.stringify(meta),'utf8');await fs.promises.rename(mt,this.metaFile);}
  async clear(){this.docs.clear();this.inv.clear();this.versions.clear();this.graph.clear();await this.flush();}
}
