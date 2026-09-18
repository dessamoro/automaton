#!/usr/bin/env node
/**
 * Oracle CLI
 *
 * Lets the human operator answer Lakshmi's ask_oracle requests.
 *
 * Usage:
 *   npm run oracle -- "Your guidance here"
 *   npm run oracle          (shows any pending question, then exits)
 */

import Database from "better-sqlite3";
import path from "path";
import { ulid } from "ulid";

// Resolve the automaton dir the same way wallet.ts does
const AUTOMATON_DIR = path.join(process.env.HOME || "/root", ".automaton");
const DB_PATH = path.join(AUTOMATON_DIR, "automaton.db");

function openDb() {
  try {
    return new Database(DB_PATH, { readonly: false });
  } catch (err) {
    console.error(\n Could not open automaton.db at );
    console.error(   Is the automaton installed? (Run npm start -- --init first)\n);
    console.error(err.message);
    process.exit(1);
  }
}

function showPendingQuestion(db) {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = 'oracle_pending_question'")
    .get();

  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function main() {
  const answer = process.argv[2]?.trim();
  const db = openDb();

  const pending = showPendingQuestion(db);

  if (!pending) {
    console.log("\n No pending oracle question from Lakshmi.\n");
    db.close();
    return;
  }

  console.log("\n Pending Oracle Question:");
  console.log(   Question: "");
  if (pending.context) {
    console.log(   Context:  );
  }
  console.log();

  if (!answer) {
    console.log('Run with your response: npm run oracle -- "Your answer here"');
    console.log();
    db.close();
    return;
  }

  const id = ulid();
  const content = [Oracle Response]: ;

  // Insert the operator's answer into Lakshmi's inbox as a trusted system message
  db.prepare(
    INSERT INTO inbox_messages (id, from_address, to_address, content, received_at, status)
     VALUES (?, 'oracle', 'self', ?, datetime('now'), 'received')
  ).run(id, content);

  // Insert a wake event so she wakes within 30s (the sleep poll interval)
  db.prepare(
    "INSERT INTO wake_events (source, reason, payload) VALUES (?, ?, ?)"
  ).run("oracle", Human responded: , JSON.stringify({ answerId: id }));

  // Clear the pending question
  db.prepare("DELETE FROM kv WHERE key = 'oracle_pending_question'").run();

  console.log(" Response delivered to Lakshmi's inbox.");
  console.log("   She will wake within 30 seconds and read your answer.\n");

  db.close();
}

main();
