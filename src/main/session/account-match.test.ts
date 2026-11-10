import { describe, expect, it } from "vitest";
import { findAccountMismatch } from "./account-match";

const known = [
  { email: "shop@example.com", memberId: "111" },
  { email: "second@example.com", memberId: "222" },
];

describe("findAccountMismatch", () => {
  it("accepts the account the email was linked as before", () => {
    expect(findAccountMismatch(" Shop@Example.com ", "111", known)).toBeNull();
  });

  it("flags a login to another account for a known email", () => {
    expect(findAccountMismatch("shop@example.com", "999", known)).toEqual({ kind: "different-account" });
  });

  it("flags a login to an account linked under another email", () => {
    expect(findAccountMismatch("new@example.com", "222", known)).toEqual({
      kind: "linked-as",
      linkedAs: "second@example.com",
    });
  });

  it("can't tell without a member id or anything known", () => {
    expect(findAccountMismatch("new@example.com", "333", known)).toBeNull();
    expect(findAccountMismatch("shop@example.com", undefined, known)).toBeNull();
    expect(findAccountMismatch("shop@example.com", "999", [])).toBeNull();
  });
});
