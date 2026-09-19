/**
 * Utilities for constructing persistent S3 paths for browser profiles.
 * Profiles are stored with account-based identifiers, not timestamps,
 * so they can be refreshed and updated over time.
 */

export interface ProfileS3Path {
  bucket: string;
  key: string;
  fullPath: string;
}

/**
 * Construct a persistent S3 path for a Vinted account profile.
 *
 * Format: profiles/{userId}/{vintedMemberId}/{browser}.tar.gz
 * Example: profiles/user_abc123/vinted_12345/chrome.tar.gz
 *
 * This is persistent and can be overwritten to refresh the profile.
 */
export function constructProfileS3Path(
  userId: string,
  vintedMemberId: string,
  browser: "chrome" | "firefox" | "edge"
): ProfileS3Path {
  if (!userId || !vintedMemberId) {
    throw new Error(
      "userId and vintedMemberId are required for S3 path construction"
    );
  }

  // Sanitize IDs to be S3-safe (alphanumeric, dash, underscore)
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sanitizedMemberId = vintedMemberId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const key = `profiles/${sanitizedUserId}/${sanitizedMemberId}/${browser}.tar.gz`;
  const bucket = process.env.REACT_APP_AWS_S3_BUCKET || "profiles";
  const fullPath = `s3://${bucket}/${key}`;

  return {
    bucket,
    key,
    fullPath,
  };
}

/**
 * Extract user ID and member ID from email (for fallback scenarios).
 * Used when userId is not explicitly provided.
 */
export function extractIdsFromEmail(email: string): {
  userId: string;
  memberId: string;
} {
  // Use email prefix as userId (e.g., "john.doe@example.com" → "john_doe")
  const [emailPrefix] = email.split("@");
  const userId = emailPrefix.replace(/[^a-zA-Z0-9]/g, "_");

  return {
    userId,
    memberId: userId, // Fallback: use same as userId
  };
}

/**
 * Format S3 path for HTTP headers.
 * Headers expect just the key, not the full s3:// path.
 */
export function getS3HeaderValue(s3Path: ProfileS3Path): string {
  return s3Path.key;
}
