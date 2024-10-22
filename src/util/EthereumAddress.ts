import { Either, left, right } from "monads-io/either";

export class EthereumAddress {
    private readonly address: string;
    private readonly correctlyCreated: boolean = false;

    constructor(address: string) {
        address = address.toLowerCase();
        if (!address.startsWith("0x")) {
            address = "0x" + address;
        }

        if (!this.validateEthereumAddress(address)) {
            throw new Error("Invalid Ethereum address");
        }

        this.address = address;
        this.correctlyCreated = true;
    }

    private validateEthereumAddress(address: string): boolean {
        return /^(0x)?[0-9a-f]{40}$/i.test(address);
    }

    public getAddress(): string {
        if (!this.correctlyCreated) {
            throw new Error("EthereumAddress not correctly created");
        }

        return this.address;
    }

    public getBytes(): Uint8Array {
        return new TextEncoder().encode(this.getAddress());
    }

    public toJSON(): string {
        return this.getAddress();
    }

    public static fromJSON(json: string): EthereumAddress {
        return new EthereumAddress(json);
    }

    public static fromBytes(bytes: Uint8Array): Either<Error, EthereumAddress> {
        try {
            return right(new EthereumAddress(Buffer.from(bytes).toString('hex')));
        } catch (e) {
            return left(e as Error);
        }
    }

    public static fromString(str: string): Either<Error, EthereumAddress> {
        try {
            return right(new EthereumAddress(str));
        } catch (e) {
            return left(e as Error);
        }
    }
}

if (import.meta.vitest) {
    const {describe, it, expect} = import.meta.vitest;
    describe("EthereumAddress", () => {
        it("should create a valid EthereumAddress with correct format", () => {
            const address = new EthereumAddress("0x1234567890123456789012345678901234567890");
            expect(address.getAddress()).toBe("0x1234567890123456789012345678901234567890");
        });

        it("should throw an error for an invalid Ethereum address", () => {
            expect(() => new EthereumAddress("invalid_address")).toThrow("Invalid Ethereum address");
        });

        it("should enforce lowercase addresses", () => {
            const mixedCaseAddress = "0xaaBbccDdEeff1234567890123456789012345678".toLowerCase();
            const address = new EthereumAddress(mixedCaseAddress);
            expect(address.getAddress()).toBe("0xaabbccddeeff1234567890123456789012345678");
        });

        it("should correctly serialize and deserialize to/from JSON", () => {
            const originalAddress = "0x1234567890123456789012345678901234567890";
            const address = new EthereumAddress(originalAddress);
            const json = address.toJSON();
            const deserializedAddress = EthereumAddress.fromJSON(json);
            expect(deserializedAddress.getAddress()).toBe(originalAddress);
        });
    });
}
