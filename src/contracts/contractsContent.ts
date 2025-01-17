import composedStreamTemplate from "./composed_stream_template.json" with { type: "json" };
import primitiveStreamTemplate from "./primitive_stream_template.json" with { type: "json" };
import composedStreamTemplateUnix from "./composed_stream_template_unix.json" with { type: "json" };
import primitiveStreamTemplateUnix from "./primitive_stream_template_unix.json" with { type: "json" };

export { composedStreamTemplate, primitiveStreamTemplate, composedStreamTemplateUnix, primitiveStreamTemplateUnix };

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

    it("composedStreamTemplateUnix", () => {
      expect(composedStreamTemplateUnix).toBeDefined();
      expect(composedStreamTemplateUnix.name).toBe("composed_stream_db_name");
    });

    it("primitiveStreamTemplateUnix", () => {
      expect(primitiveStreamTemplateUnix).toBeDefined();
      expect(primitiveStreamTemplateUnix.name).toBe("primitive_stream_db_name");
    });
  });
}
