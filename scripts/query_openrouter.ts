import * as fs from "node:fs";

/**
 * Query OpenRouter directly from Antigravity IDE.
 * Usage: npx tsx scripts/query_openrouter.ts "<prompt>" [model]
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: npx tsx scripts/query_openrouter.ts \"<prompt>\" [model]");
    process.exit(1);
  }

  const prompt = args[0];
  const model = args[1] || process.env.OPENAI_MODEL || "deepseek/deepseek-v4-flash-0731:free";

  // Load .env
  let key = process.env.OPENROUTER_API_KEY;
  if (!key && fs.existsSync(".env")) {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/OPENROUTER_API_KEY=(.*)/);
    if (match) key = match[1].replace(/["']/g, "").trim();
  }

  if (!key) {
    console.error("Error: OPENROUTER_API_KEY not found in environment or .env");
    process.exit(1);
  }

  console.log(`[OpenRouter Query] Model: ${model}`);
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://antigravity.google",
      "X-Title": "Antigravity IDE Assistant"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`OpenRouter Error (${res.status}):`, text);
    process.exit(1);
  }

  const data = await res.json() as any;
  const reply = data.choices?.[0]?.message?.content;
  console.log("\n--- Response ---");
  console.log(reply || "[No content returned]");
}

main().catch(console.error);
