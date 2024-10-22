import composedStreamTemplate from "./composed_stream_template.json";
import primitiveStreamTemplate from "./primitive_stream_template.json";

export { composedStreamTemplate, primitiveStreamTemplate };

if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;
    describe("contracts", () => {
        it("composedStreamTemplate", () => {
            expect(composedStreamTemplate).toBeDefined();
            expect(composedStreamTemplate.name).toBe("composed_stream_db_name");
        });

        it("primitiveStreamTemplate", () => {
            expect(primitiveStreamTemplate).toBeDefined();
            expect(primitiveStreamTemplate.name).toBe("primitive_stream_db_name");
        });
    });
}