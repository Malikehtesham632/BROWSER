import {canonicalUrlKey} from '../core/url.js';
const tokenize=s=>new Set(String(s||'').toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g)||[]);
function bm25(doc,q,avgdl){const terms=q.terms;const text=String(`${doc.title} ${doc.description} ${doc.headings?.join(' ')} ${doc.content}`).toLowerCase();const words=text.match(/[a-z0-9][a-z0-9._-]{1,}/g)||[];const tf=new Map();for(const w of words)tf.set(w,(tf.get(w)||0)+1);const N=Math.max(1,q.N),k1=1.2,b=.75,dl=words.length||1;let score=0;for(const term of terms){const f=tf.get(term)||0;if(!f)continue;const df=q.df?.get(term)||1;const idf=Math.log(1+(N-df+0.5)/(df+0.5));score+=idf*((f*(k1+1))/(f+k1*(1-b+b*dl/Math.max(avgdl,1))));}return score;}
export function rankIndexed(docs,q,{limit=20}={}){
  const N=docs.length,df=new Map();for(const d of docs){for(const t of tokenize(`${d.title} ${d.description} ${d.headings?.join(' ')}`))df.set(t,(df.get(t)||0)+1)}
  const avgdl=docs.reduce((a,d)=>a+(d.wordCount||1),0)/Math.max(1,N);q={...q,N,df};
  const now=Date.now();const out=[];
  for(const d of docs){let score=bm25(d,q,avgdl);if(!score)continue;const title=String(d.title||'').toLowerCase();for(const t of q.terms)if(title.includes(t))score+=0.7;for(const p of q.phrases)if(String(`${d.title} ${d.description} ${d.content}`).toLowerCase().includes(p.toLowerCase()))score+=2.5;const age=Math.max(0,(now-Date.parse(d.indexedAt||0))/86400000);score*=1/(1+age/3650);const spam=(d.wordCount<80?0.7:1)*(d.wordCount>100000?0.8:1);score*=spam;out.push({...d,score});}
  return out.sort((a,b)=>b.score-a.score).slice(0,limit);
}
