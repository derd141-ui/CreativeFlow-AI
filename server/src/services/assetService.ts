import { notFound, badRequest } from "../lib/errors.js";
import { limitsFor } from "../lib/limits.js";
import type { Deps } from "./context.js";

/** Object-storage-backed asset management. */
export function assetService(deps: Deps) {
  const { store, storage } = deps;

  const own = <T>(v: T | null): T => { if (v == null) throw notFound(); return v; };

  /**
   * Create an asset row and return a pre-signed PUT URL. The browser uploads
   * the bytes directly to object storage; metadata lives in the DB.
   */
  async function createUpload(ownerId: string, input: { name: string; mime?: string; kind?: string; projectId?: string | null; size?: number }) {
    if (!input.name?.trim()) throw badRequest("An asset needs a name.");
    const user = await store.getUserById(ownerId);
    const maxBytes = limitsFor(user?.plan ?? "free").maxAssetBytes;
    if ((input.size ?? 0) > maxBytes) throw badRequest(`File exceeds your plan's ${(maxBytes / 1024 / 1024).toFixed(0)}MB limit.`);

    const asset = await store.createAsset({
      ownerId, projectId: input.projectId ?? null, name: input.name, kind: input.kind ?? "other",
      mime: input.mime ?? "application/octet-stream", size: input.size ?? 0,
      bucketKey: "", sha: "", tags: [],
    });
    const key = storage.keyFor(ownerId, asset.id, input.name);
    const updated = await store.updateAsset(ownerId, asset.id, { bucketKey: key });
    const { url, fields } = await storage.presignedUpload(key, input.mime ?? "application/octet-stream", maxBytes);
    return { asset: updated ?? asset, uploadUrl: url, fields, key };
  }

  async function listAssets(ownerId: string, projectId?: string) {
    return store.listAssets(ownerId, projectId);
  }
  async function getAsset(ownerId: string, id: string) { return own(await store.getAsset(ownerId, id)); }
  async function getDownloadUrl(ownerId: string, id: string) {
    const a = own(await store.getAsset(ownerId, id));
    return { url: await storage.presignedDownload(a.bucketKey) };
  }
  async function renameAsset(ownerId: string, id: string, name: string) {
    if (!name?.trim()) throw badRequest("Name required.");
    return own(await store.updateAsset(ownerId, id, { name }));
  }
  async function deleteAsset(ownerId: string, id: string) {
    const a = own(await store.getAsset(ownerId, id));
    await storage.delete(a.bucketKey).catch(() => {});
    await store.deleteAsset(ownerId, id);
  }

  return { createUpload, listAssets, getAsset, getDownloadUrl, renameAsset, deleteAsset };
}

export type AssetService = ReturnType<typeof assetService>;