import { sha256 } from "crypto-hash";
import { Either } from "monads-io";

export class StreamId {
  private readonly id: string;
  private readonly correctlyCreated: boolean = false;

  private constructor(id: string) {
    this.id = id;
    this.correctlyCreated = true;
  }

  public getId(): string {
    if (!this.correctlyCreated) {
      throw new Error("StreamId not correctly created");
    }

    return this.id;
  }

  public validate(): boolean {
    return this.id.length === 32 && this.id.startsWith("st");
  }

  public toJSON(): string {
    return this.getId();
  }

  public static fromJSON(json: string): StreamId {
    return new StreamId(json);
  }

  public static async generate(s: string): Promise<StreamId> {
    // If the string is already a valid StreamId, return it
    if (s.length === 32 && s.startsWith("st")) {
      return new StreamId(s);
    }

    // Compute SHA-256 hash of the input string
    const hash = await sha256(s);

    // Take the first 30 characters of the hash and prepend "st"
    const streamIdStr = "st" + hash.slice(0, 30);

    return new StreamId(streamIdStr);
  }

  public static fromString(s: string): Either<Error, StreamId> {
    try {
      return Either.right(new StreamId(s));
    } catch (e) {
      return Either.left(e as Error);
    }
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("StreamId", () => {
    it("should generate a valid StreamId", async () => {
      const streamId = await StreamId.generate("cpi_india_1.1.01");
      expect(streamId.validate()).toBe(true);
      expect(streamId.getId()).toBe("st39830c44932bc42a3bffef72310948");
    });
  });
}
