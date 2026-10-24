/** Best-effort metadata JSON fetch (Metaplex standard + pump-style extensions). */
export async function fetchMetadata(uri: string | null) {
  const empty = { ok: false, image: null, description: null, website: null, twitter: null, telegram: null };
  if (!uri) return empty;
  try {
    const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return empty;
    const j: any = await res.json();
    const ext = j.extensions ?? {};
    const image = typeof j.image === "string" && j.image.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${j.image.slice(7)}` : j.image ?? null;
    return {
      ok: true,
      image,
      description: j.description ?? null,
      website: j.website ?? ext.website ?? null,
      twitter: j.twitter ?? ext.twitter ?? null,
      telegram: j.telegram ?? ext.telegram ?? null,
    };
  } catch {
    return empty;
  }
}
