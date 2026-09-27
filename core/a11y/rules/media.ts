// Media, frames and motion. Ported from a11yinspect: media-element-*, track-element-error,
// iframe-element-*, distracting-element-error.
import { closestTag, normalizeSpace, rawRole, tabindexAttr } from "../dom.js";
import { ariaTrue, hasText, type Rule, type RuleContext } from "../rule.js";

/** Track kinds from <track> children plus script-added text tracks (runtime only). */
function trackKinds(el: Element): Set<string> {
  const kinds = new Set<string>();
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName !== "track") continue;
    const k = c.getAttribute("kind");
    kinds.add(k === null ? "subtitles" : k.trim().toLowerCase());
  }
  try {
    const tt = (el as HTMLMediaElement).textTracks;
    if (tt) for (let i = 0; i < tt.length; i++) if (tt[i].kind) kinds.add(String(tt[i].kind).toLowerCase());
  } catch {
    /* no TextTrack API */
  }
  return kinds;
}

function isMuted(el: Element, a: Readonly<Record<string, string>>): boolean {
  if (a["muted"] !== undefined) return true;
  try {
    return (el as HTMLMediaElement).muted === true; // React sets `muted` as a property, not an attribute
  } catch {
    return false;
  }
}

function hasAutoplay(el: Element, a: Readonly<Record<string, string>>): boolean {
  if (a["autoplay"] !== undefined) return true;
  try {
    return (el as HTMLMediaElement).autoplay === true;
  } catch {
    return false;
  }
}

/** Runtime heuristic: a transcript is referenced or linked right next to the audio. */
function hasTranscript(el: Element, ctx: RuleContext): boolean {
  const ref = el.getAttribute("aria-describedby");
  if (ref && ctx.dom.labelledByText(ref)) return true;
  const scope = el.parentElement;
  if (!scope) return false;
  return /transcript/i.test(normalizeSpace(scope.textContent || "").slice(0, 2000));
}

export const mediaElementError: Rule = {
  id: "media-element-error",
  tags: ["video", "audio"],
  visit(el, a, ctx) {
    if (el.localName === "audio") {
      if (!hasTranscript(el, ctx)) ctx.report(el, "audioElementMissingTranscript");
      return;
    }
    // Runtime refinement: muted, control-less looping/autoplaying video is decorative background motion.
    if (isMuted(el, a) && a["controls"] === undefined && (hasAutoplay(el, a) || a["loop"] !== undefined)) return;
    const kinds = trackKinds(el);
    if (!kinds.has("captions")) ctx.report(el, "videoElementMissingCaptions");
    if (!kinds.has("descriptions")) ctx.report(el, "videoElementMissingAudioDescription");
  },
};

export const mediaElementWarning: Rule = {
  id: "media-element-warning",
  tags: ["video", "audio"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (a["controls"] !== undefined && a["role"] !== undefined) ctx.report(el, "mediaRoleWithControls");
    // Autoplaying sound matters even for an <audio> with no visible controls (no box); muted media is exempt.
    if (hasAutoplay(el, a) && !isMuted(el, a)) ctx.report(el, "mediaElementAutoplay", { scope: "all" });
    const hidden = ariaTrue(a["aria-hidden"]);
    if (el.localName === "audio") {
      if (hidden) ctx.report(el, "audioAriaHidden");
      return;
    }
    const kinds = trackKinds(el);
    if (kinds.has("captions") && !kinds.has("descriptions")) ctx.report(el, "videoCaptionsWithoutDescriptions", { scope: "visible" });
    if (hidden) ctx.report(el, "videoAriaHidden");
    else if (tabindexAttr(el) === -1) ctx.report(el, "videoAriaHidden", { detail: 'tabindex="-1"' });
  },
};

export const trackElementError: Rule = {
  id: "track-element-error",
  tags: ["track"],
  visit(el, a, ctx) {
    const host = closestTag(el, "video", "audio");
    const opts = host ? { visibilityOf: host } : { scope: "all" as const };
    if (!hasText(a["src"])) ctx.report(el, "trackMissingSrcAttribute", opts);
    const kind = a["kind"];
    if (kind === undefined) ctx.report(el, "trackMissingKindAttribute", opts);
    else if (kind.trim().toLowerCase() === "subtitles" && a["srclang"] === undefined) ctx.report(el, "trackMissingSrclangSubtitles", opts);
  },
};

function frameHidden(el: Element, a: Readonly<Record<string, string>>): boolean {
  const r = rawRole(el);
  return r === "presentation" || r === "none" || ariaTrue(a["aria-hidden"]);
}

export const iframeElementError: Rule = {
  id: "iframe-element-error",
  tags: ["iframe"],
  visit(el, a, ctx) {
    if (frameHidden(el, a)) return;
    if (ctx.dom.ariaName(el)) return; // runtime: aria-label / aria-labelledby name the frame too
    const title = a["title"];
    if (title === undefined) ctx.report(el, "iframeMissingTitle");
    else if (!title.trim()) ctx.report(el, "iframeEmptyTitle");
  },
};

export const iframeElementWarning: Rule = {
  id: "iframe-element-warning",
  tags: ["iframe"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (frameHidden(el, a)) ctx.report(el, "iframeHidden");
  },
};

export const distractingElementError: Rule = {
  id: "distracting-element-error",
  tags: ["marquee", "blink"],
  visit(el, _a, ctx) {
    ctx.report(el, el.localName === "marquee" ? "noMarquee" : "noBlink");
  },
};

export const MEDIA_RULES: readonly Rule[] = [
  mediaElementError, mediaElementWarning, trackElementError, iframeElementError, iframeElementWarning, distractingElementError,
];
