export const MISSING_EVIDENCE_BOUNDARY_EXIT = '86';

export function verifyMissingEvidenceBoundary({ githubExit, gitlabExit, githubEvidenceExists, gitlabEvidenceExists }) {
  if (githubExit.trim() !== MISSING_EVIDENCE_BOUNDARY_EXIT || gitlabExit.trim() !== MISSING_EVIDENCE_BOUNDARY_EXIT) {
    throw new Error('missing compliance evidence did not produce the designated boundary verdict on both adapters');
  }
  if (githubEvidenceExists || gitlabEvidenceExists) {
    throw new Error('missing compliance evidence fixture unexpectedly retained an evidence artifact');
  }
}
