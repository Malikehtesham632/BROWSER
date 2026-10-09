const STOP = new Set('a an and are as at be by for from has have how i in is it of on or that the this to was what when where which who why with you'.split(' '));
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export function analyzeQuery(input){
  const raw=String(input??'').replace(/\s+/g,' ').trim();
  if(!raw) return {raw:'',terms:[],phrases:[],site:null,intent:'informational'};
  const phrases=[]; const without=raw.replace(/"([^"]+)"/g,(_,p)=>{phrases.push(p.trim());return ' ';});
  let site=null;
  const siteMatch=without.match(/(?:^|\s)site:([^\s]+)/i);
  if(siteMatch){site=siteMatch[1].toLowerCase();}
  const cleaned=without.replace(/(?:^|\s)site:[^\s]+/ig,' ');
  const tokens=(cleaned.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g)||[]).filter(x=>!STOP.has(x));
  const intent=/\b(how|what|why|tutorial|guide|learn|example)\b/i.test(raw)?'informational':
    /\b(buy|price|cost|cheap|deal|shop|order)\b/i.test(raw)?'transactional':
    /\b(login|sign in|official|website)\b/i.test(raw)?'navigational':'general';
  return {raw,terms:[...new Set(tokens)],phrases:[...new Set(phrases.filter(Boolean))],site,intent};
}
export function queryFeatures(q){
  return {...q,termCount:q.terms.length,phraseCount:q.phrases.length,complexity:clamp(q.terms.length+q.phrases.length*2,1,20)};
}
