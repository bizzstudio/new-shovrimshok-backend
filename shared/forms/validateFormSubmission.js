/**
 * ולידציה גנרית לפי schema.validation (פרונט; אופציונלי גם בבקאנד)
 */
export function validateFormSubmission(schema, state, isSignatureEmpty) {
  const v = schema?.validation;
  if (!v) return { ok: true };

  if (v.type === "matrix") {
    for (const k of v.requiredFooterKeys || []) {
      if (!String(state[k] ?? "").trim()) {
        return { ok: false, reason: "missingFooter", key: k };
      }
    }
    if (v.requireSignature && isSignatureEmpty) {
      return { ok: false, reason: "missingSignature" };
    }
    return { ok: true };
  }

  if (v.type === "table") {
    if (v.requireAnyContentKeys?.length) {
      const any = v.requireAnyContentKeys.some((k) =>
        String(state[k] ?? "").trim()
      );
      if (!any) return { ok: false, reason: "missingContent" };
    }
    for (const k of v.requiredKeys || []) {
      if (!String(state[k] ?? "").trim()) {
        return { ok: false, reason: "missingField", key: k };
      }
    }
    if (v.requireSignature && isSignatureEmpty) {
      return { ok: false, reason: "missingSignature" };
    }
    return { ok: true };
  }

  return { ok: true };
}
