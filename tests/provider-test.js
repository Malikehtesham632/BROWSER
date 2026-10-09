import {loadConfig,loadEnvFile} from "../src/config.js";
import {createSearchEngine} from "../src/search.js";

loadEnvFile();
const query=process.argv.slice(2).join(" ").trim()||"Python FastAPI authentication";
const config=loadConfig();
const engine=createSearchEngine(config);
console.log("Omni Engine v2 Provider Test");
console.log("Query:",query);
console.log("Providers:",engine.providerNames().join(", ")||"(none)");
try{
  const out=await engine.search(query,{limit:10,onProvider:({provider,results})=>{
    console.log(`\n${provider.ok?"✓":"✗"} ${provider.name}: ${provider.ok?`${provider.count} result(s)`:provider.error}`);
  }});
  console.log("\n--- Omni ranked results ---");
  out.results.forEach((r,i)=>console.log(`\n${i+1}. ${r.title}\n${r.url}\nSources: ${r.sources.join(", ")} | score: ${r.score}\n${r.snippet}`));
  console.log(`\nTotal: ${out.results.length} | Took: ${out.tookMs}ms | Cached: ${out.cached}`);
}catch(e){console.error("\n✗ Search failed:",e.message);process.exitCode=1}
