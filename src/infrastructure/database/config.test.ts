import { describe, expect, it } from "vitest";
import { getDatabaseName, getDatabaseUrl } from "./config";
import { DatabaseError, toDatabaseError } from "./errors";
import { timestampColumns, uuidPrimaryKey } from "./schema";

describe("database config", () => {
  it("rejects a missing DATABASE_URL without echoing env content", () => {
    try {
      getDatabaseUrl({} as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).category).toBe("configuration");
    }
  });

  it("extracts the database name from the URL", () => {
    expect(getDatabaseName("postgresql://u:p@localhost:5432/agent_ready_kit")).toBe(
      "agent_ready_kit",
    );
  });

  it("rejects a URL without a database name", () => {
    expect(() => getDatabaseName("postgresql://u:p@localhost:5432/")).toThrow(DatabaseError);
    expect(() => getDatabaseName("not a url")).toThrow(DatabaseError);
  });
});

describe("database error redaction", () => {
  it("never propagates raw driver messages that may contain secrets", () => {
    const driverError = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });
    const redacted = toDatabaseError(
      "connection",
      Object.assign(driverError, {
        message: `connection "postgresql://admin:s3cret@db:5432/app" refused`,
      }),
    );
    expect(redacted).toBeInstanceOf(DatabaseError);
    expect(redacted.category).toBe("connection");
    expect(redacted.message).toContain("28P01");
    expect(redacted.message).not.toContain("s3cret");
  });
});

describe("table conventions", () => {
  it("provides uuid PK plus created_at/updated_at columns", () => {
    expect(Object.keys({ ...uuidPrimaryKey(), ...timestampColumns() })).toEqual([
      "id",
      "createdAt",
      "updatedAt",
    ]);
  });
});
