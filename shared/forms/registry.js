import { T01 } from "./T01.js";
import { T02 } from "./T02.js";
import { T03 } from "./T03.js";

const BY_CODE = {
  T01,
  T02,
  T03,
};

export const FORM_SCHEMAS = Object.freeze([T01, T02, T03]);

export function getFormSchema(formCode) {
  const code = String(formCode || "").toUpperCase();
  return BY_CODE[code] ?? null;
}

export function isKnownFormCode(formCode) {
  return getFormSchema(formCode) != null;
}

export function listFormCodes() {
  return Object.keys(BY_CODE);
}
