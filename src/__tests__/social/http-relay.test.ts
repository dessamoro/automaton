import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpDirectRelay } from "../../social/http-relay.js";
import type { SignedMessage } from "../../social/protocol.js";

describe("HttpDirectRelay", () => {
  let tmpDir: string;
  let inboxFile: string;
  let relay: HttpDirectRelay;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "http-relay-test-"));
    inboxFile = path.join(tmpDir, "inbox.jsonl");
    relay = new HttpDirectRelay();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("receive returns empty array if inbox file does not exist", async () => {
    const messages = await relay.receive(path.join(tmpDir, "nonexistent.jsonl"));
    expect(messages).toEqual([]);
  });

  it("receive reads and clears inbox file", async () => {
    const sampleMessage: SignedMessage = {
      id: "msg-001",
      from: "0x123",
      to: "0x456",
      content: "hello world",
      timestamp: new Date().toISOString(),
      nonce: "random-nonce",
      signature: "0xabc",
    };

    fs.writeFileSync(inboxFile, JSON.stringify(sampleMessage) + "\n", "utf-8");

    const received = await relay.receive(inboxFile);
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe("msg-001");
    expect(received[0].content).toBe("hello world");

    // File should now be cleared
    const remaining = fs.readFileSync(inboxFile, "utf-8");
    expect(remaining).toBe("");
  });

  it("send posts signed message to targetUrl/inbox", async () => {
    const sampleMessage: SignedMessage = {
      id: "msg-002",
      from: "0x123",
      to: "0x456",
      content: "ping",
      timestamp: new Date().toISOString(),
      nonce: "nonce-2",
      signature: "0xdef",
    };

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const success = await relay.send(sampleMessage, "https://agent-b.example.com/");
    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://agent-b.example.com/inbox",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleMessage),
      }),
    );
  });
});
