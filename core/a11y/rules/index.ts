// All 89 ported rules, grouped by area. Rule ids are the a11yinspect rule file names.
import type { Rule } from "../rule.js";
import { ARIA_RULES } from "./aria.js";
import { DOCUMENT_RULES } from "./document.js";
import { FORM_RULES } from "./forms.js";
import { IMAGE_RULES } from "./images.js";
import { INTERACTIVE_RULES } from "./interactive.js";
import { MEDIA_RULES } from "./media.js";
import { STRUCTURE_RULES } from "./structure.js";
import { TABLE_RULES } from "./tables.js";

export const RULE_GROUPS: Readonly<Record<string, readonly Rule[]>> = {
  images: IMAGE_RULES,
  interactive: INTERACTIVE_RULES,
  forms: FORM_RULES,
  aria: ARIA_RULES,
  structure: STRUCTURE_RULES,
  tables: TABLE_RULES,
  media: MEDIA_RULES,
  document: DOCUMENT_RULES,
};

export const ALL_RULES: readonly Rule[] = Object.values(RULE_GROUPS).flat();
