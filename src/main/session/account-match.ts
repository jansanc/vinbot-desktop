/**
 * Noticing a Vinted login to a different account than the email typed in.
 *
 * Vinted's login page doesn't show which email is signed in, so a user with
 * two Vinted accounts (or a browser that remembered another one) can log in
 * to the wrong one. Saved, that session would be stored under the wrong email
 * and Vinbot would act on the wrong shop. The window remembers which Vinted
 * member each email it linked belonged to, and passes that list in.
 */

/** An email this computer linked before, and the Vinted member it was. */
export interface KnownVintedAccount {
  email: string;
  memberId: string;
}

export type AccountMismatch =
  /** The email was linked before as another member: a different account. */
  | { kind: "different-account" }
  /** The member logged in to is already linked under another email. */
  | { kind: "linked-as"; linkedAs: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function findAccountMismatch(
  vintedEmail: string,
  memberId: string | undefined,
  known: readonly KnownVintedAccount[] | undefined
): AccountMismatch | null {
  if (!memberId || !known?.length) return null;
  const forEmail = known.find((k) => same(k.email, vintedEmail));
  if (forEmail) return forEmail.memberId === memberId ? null : { kind: "different-account" };
  const other = known.find((k) => k.memberId === memberId);
  return other ? { kind: "linked-as", linkedAs: other.email } : null;
}
