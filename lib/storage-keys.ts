/**
 * R2 object keys live in one place so the convention can't drift.
 * Layout: `resumes/{userId}/{resumeId}.pdf` — easy per-user enumeration,
 * easy bulk delete when a user is wiped, no path traversal risk since the
 * values come from our own DB.
 */
export function resumeKey(userId: string, resumeId: string, ext: "pdf" = "pdf"): string {
  return `resumes/${userId}/${resumeId}.${ext}`;
}
