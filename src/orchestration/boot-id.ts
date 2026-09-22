import { randomBytes } from "crypto";

export const BOOT_ID = `${process.pid}-${randomBytes(4).toString("hex")}`;
