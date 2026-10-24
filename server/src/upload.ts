import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

async function pinata(name: string, body: Buffer | string, contentType: string): Promise<string> {
  const jwt = process.env.PINATA_JWT!;
  const form = new FormData();
  form.append("file", new Blob([typeof body === "string" ? body : new Uint8Array(body)], { type: contentType }), name);
  form.append("network", "public");
  const res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
  if (!res.ok) throw new Error(`pinata ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  const cid = j.data?.cid;
  const gw = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
  return `https://${gw}/ipfs/${cid}`;
}

async function store(name: string, body: Buffer | string, contentType: string): Promise<string> {
  if (process.env.PINATA_JWT) return pinata(name, body, contentType);
  const file = `${crypto.randomBytes(8).toString("hex")}-${name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), body);
  return `${process.env.PUBLIC_URL || "http://localhost:8787"}/uploads/${file}`;
}

export function uploadRouter() {
  const r = express.Router();
  r.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1y", immutable: true }));

  /** multipart: image (file), name, symbol, description, website, twitter, telegram -> { uri, image } */
  r.post("/api/upload", upload.single("image"), async (req, res) => {
    try {
      const { name, symbol, description = "", website = "", twitter = "", telegram = "" } = req.body ?? {};
      if (!name || !symbol) return res.status(400).json({ error: "name and symbol required" });
      if (String(name).length > 32 || String(symbol).length > 10) return res.status(400).json({ error: "name ≤ 32 chars, symbol ≤ 10" });
      let image: string | null = null;
      if (req.file) {
        const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
        const ext = EXT[req.file.mimetype] || "png";
        image = await store(`image.${ext}`, req.file.buffer, req.file.mimetype);
      }
      const json = {
        name,
        symbol,
        description,
        image,
        showName: true,
        createdOn: "PEOPLE'S PAD",
        website: website || undefined,
        twitter: twitter || undefined,
        telegram: telegram || undefined,
        extensions: { website: website || undefined, twitter: twitter || undefined, telegram: telegram || undefined },
      };
      const uri = await store("metadata.json", JSON.stringify(json), "application/json");
      if (uri.length > 200) return res.status(500).json({ error: "uri too long for on-chain metadata" });
      res.json({ uri, image });
    } catch (e) {
      console.error("upload", e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
  return r;
}
