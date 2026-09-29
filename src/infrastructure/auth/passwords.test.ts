// Password handling contract (TASK-010): bcrypt hashes verify, wrong
// passwords don't, and two hashes of the same password differ (salted).
// Registration and authorize() both go through bcryptjs — this pins the
// round-trip both sides rely on.
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

describe("password hashing", () => {
  it("round-trips through hash and compare", async () => {
    const hash = await bcrypt.hash("correct-horse-1", 12);
    await expect(bcrypt.compare("correct-horse-1", hash)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-password", hash)).resolves.toBe(false);
  });

  it("salts identical passwords differently", async () => {
    const [a, b] = await Promise.all([
      bcrypt.hash("same-password", 12),
      bcrypt.hash("same-password", 12),
    ]);
    expect(a).not.toBe(b);
  });
});
