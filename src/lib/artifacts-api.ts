import type { ArtifactDetail, ArtifactPatch, RunRecord } from "@/types";

export async function fetchArtifact(
  path: string,
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function patchArtifact(
  path: string,
  patch: ArtifactPatch,
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts?path=${encodeURIComponent(path)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function archiveArtifact(
  path: string,
): Promise<{ originalPath: string; newPath: string }> {
  const res = await fetch(
    `/api/artifacts/archive?path=${encodeURIComponent(path)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function markRunReviewed(
  runId: string,
): Promise<RunRecord> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/reviewed`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function unmarkRunReviewed(
  runId: string,
): Promise<RunRecord> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/reviewed`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
