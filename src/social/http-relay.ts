/**
 * HTTP Direct Relay
 *
 * Replaces social.conway.tech with direct HTTP POST
 * between agents using their public endpoints or local sandboxes.
 *
 * Message format: signed JSON with signature verification.
 * Delivery: POST to target agent's /inbox endpoint.
 */

import fs from "node:fs";
import type { SignedMessage } from "./protocol.js";

export interface SocialRelay {
  send(message: SignedMessage, targetUrl: string): Promise<boolean>;
  receive(inboxPath: string): Promise<SignedMessage[]>;
}

export class HttpDirectRelay implements SocialRelay {
  async send(message: SignedMessage, targetUrl: string): Promise<boolean> {
    try {
      const sanitizedUrl = targetUrl.replace(/\/$/, "");
      const resp = await fetch(`${sanitizedUrl}/inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async receive(inboxPath: string): Promise<SignedMessage[]> {
    if (!fs.existsSync(inboxPath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(inboxPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const messages: SignedMessage[] = lines.map((line) => JSON.parse(line));
      
      // Clear processed inbox messages
      fs.writeFileSync(inboxPath, "", "utf-8");
      return messages;
    } catch {
      return [];
    }
  }
}
