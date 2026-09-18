#!/usr/bin/env node
/**
 * Oracle CLI
 *
 * Lets the human operator answer Lakshmi's ask_oracle requests.
 *
 * Usage:
 *   npm run oracle -- "Your guidance here"
 *   npm run oracle                  (shows any pending question, then exits)
 *   npm run oracle -- --list        (lists history of oracle interactions)
 *   npm run oracle -- --watch       (polls every 10s for new questions)
 */

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import { ulid } from "ulid";

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir();
const AUTOMATON_DIR = path.join(HOME_DIR, ".automaton");
const DB_PATH = path.join(AUTOMATON_DIR, "automaton.db");

function openDb() {
  try {
    return new Database(DB_PATH, { readonly: false });
  } catch (err: any) {
    console.error(`\n❌ Could not open automaton.db at ${DB_PATH}`);
    console.error(`   Is the automaton installed? (Run npm start -- --init first)\n`);
    console.error(err.message);
    process.exit(1);
  }
}

interface PendingQuestion {
  question: string;
  context?: string;
  askedAt: string;
}

function showPendingQuestion(db: any): PendingQuestion | null {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = 'oracle_pending_question'")
    .get() as { value: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.value) as PendingQuestion;
  } catch {
    return null;
  }
}

function listHistory(db: any) {
  const rows = db
    .prepare(
      "SELECT id, content, received_at FROM inbox_messages WHERE from_address = 'oracle' ORDER BY received_at DESC LIMIT 20",
    )
    .all() as Array<{ id: string; content: string; received_at: string }>;

  console.log("\n📜 Past Oracle Responses to Lakshmi:\n");
  if (!rows || rows.length === 0) {
    console.log("   No past oracle responses found.\n");
    return;
  }

  for (const r of rows) {
    console.log(`[${r.received_at}] (${r.id})`);
    console.log(`  ${r.content}`);
    console.log("─".repeat(60));
  }
  console.log();
}

function answerQuestion(db: any, answer: string, pending: PendingQuestion | null) {
  const id = ulid();
  const content = `[Oracle Response]: ${answer}`;

  // Insert operator's answer into Lakshmi's inbox
  db.prepare(
    `INSERT INTO inbox_messages (id, from_address, to_address, content, received_at, status)
     VALUES (?, 'oracle', 'self', ?, datetime('now'), 'received')`,
  ).run(id, content);

  // Insert wake event
  db.prepare(
    "INSERT INTO wake_events (source, reason, payload) VALUES (?, ?, ?)",
  ).run("oracle", `Human responded: ${answer.slice(0, 50)}`, JSON.stringify({ answerId: id }));

  // Clear pending question
  db.prepare("DELETE FROM kv WHERE key = 'oracle_pending_question'").run();

  console.log("\n✅ Response delivered to Lakshmi's inbox.");
  console.log("   She will wake within 30 seconds and read your answer.\n");
}

function watchLoop(db: any) {
  console.log("\n👀 Watching for pending questions from Lakshmi (Ctrl+C to stop)...\n");
  let lastSeenAskedAt = "";

  const check = () => {
    const pending = showPendingQuestion(db);
    if (pending && pending.askedAt !== lastSeenAskedAt) {
      lastSeenAskedAt = pending.askedAt;
      console.log(`\n🔔 [${pending.askedAt}] Lakshmi asked a question:`);
      console.log(`   Question: "${pending.question}"`);
      if (pending.context) {
        console.log(`   Context:  ${pending.context}`);
      }
      console.log(`\n   To respond: npm run oracle -- "Your answer here"\n`);
    }
  };

  check();
  setInterval(check, 10000);
}

function main() {
  const args = process.argv.slice(2);
  const db = openDb();

  if (args.includes("--list")) {
    listHistory(db);
    db.close();
    return;
  }

  if (args.includes("--watch")) {
    watchLoop(db);
    return;
  }

  const answer = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  const pending = showPendingQuestion(db);

  if (!pending && !answer) {
    console.log("\n✨ No pending oracle question from Lakshmi.\n");
    db.close();
    return;
  }

  if (pending) {
    console.log("\n🔮 Pending Oracle Question:");
    console.log(`   Asked:    ${pending.askedAt}`);
    console.log(`   Question: "${pending.question}"`);
    if (pending.context) {
      console.log(`   Context:  ${pending.context}`);
    }
    console.log();
  }

  if (!answer) {
    console.log('Run with your response: npm run oracle -- "Your answer here"');
    console.log();
    db.close();
    return;
  }

  answerQuestion(db, answer, pending);
  db.close();
}

main();
