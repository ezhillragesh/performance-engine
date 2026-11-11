// Unified accessibility rule catalog: the one rule set the extension and the demo present.
//
// It is built from three open-source rule engines (see THIRD_PARTY_NOTICES.md): the runtime port of
// BarrierBreak eslint-plugin-a11yinspect (core/a11y, MIT), IBM Equal Access accessibility-checker-
// engine (Apache-2.0) and Deque axe-core (MPL-2.0). Every source rule / check maps to exactly one
// unified rule (`a11y/__tests__/unified-coverage.test.ts` enforces it against the installed engines
// and lists unmapped ids after an upgrade). Titles, descriptions and help are our own wording.
//
// Source keys: "a11yinspect:<rule>/<messageId>", "ibm:<ruleId>", "axe:<ruleId>".
// `criteria` are WCAG success criteria (wcag.ts); rules without any are best practices.
// Section 508 / EN 301 549 applicability is derived from the criteria (WCAG 2.0 / 2.1 A+AA).
import type { A11yEngineId } from "../types.js";
import { WCAG_CRITERIA, wcagCriterion, type A11yStandard, criterionInStandard } from "../wcag.js";

export type UnifiedRuleTag = "best-practice" | "section508" | "en301549";

export interface UnifiedWcagRef {
  criterion: string;
  level: "A" | "AA" | "AAA";
  version: "2.0" | "2.1" | "2.2";
}

export interface UnifiedRule {
  /** Short kebab id, e.g. "image-alt". */
  id: string;
  /** The requirement, e.g. "Images must have a text alternative". */
  title: string;
  /** What the rule checks. */
  description: string;
  /** How to fix it. */
  help: string;
  wcag: UnifiedWcagRef[];
  tags: UnifiedRuleTag[];
  /** Source rule keys, e.g. ["axe:image-alt", "ibm:img_alt_valid", "a11yinspect:img-element-error/imgMissingAlt"]. */
  sources: string[];
}

type Def = [id: string, title: string, description: string, help: string, criteria: string[], sources: string[]];

const ai = (rule: string, ...checks: string[]): string[] => checks.map((c) => `a11yinspect:${rule}/${c}`);
const ibm = (...ids: string[]): string[] => ids.map((r) => `ibm:${r}`);
const axe = (...ids: string[]): string[] => ids.map((r) => `axe:${r}`);
const BP: string[] = []; // best practice: no success criterion

const DEFS: Def[] = [
  // ── Images and text alternatives ──
  ["image-alt", "Images must have a text alternative", "Checks that informative images expose a text alternative.", "Add an alt attribute that says what the image shows or does. Use alt=\"\" only when the image is purely decorative.", ["1.1.1"], [
    ...ai("img-element-error", "imgMissingAlt", "imgEmptyAlt", "imgMissingAltNoAria"),
    ...ai("a-element-error", "linkImgMissingAlt"),
    ...ai("button-element-error", "buttonImgMissingAlt", "buttonImgEmptyAlt"),
    ...ibm("img_alt_valid"),
    ...axe("image-alt"),
  ]],
  ["image-alt-quality", "Text alternatives must describe the image", "Flags alt text that is a file name, a generic word such as \"image\", or overly long.", "Replace file names and generic words with a short description of the image's content or purpose (under about 150 characters).", ["1.1.1"], [
    ...ai("img-element-warning", "imgAltFilename", "imgAltGeneric"),
    ...ai("button-element-error", "buttonImgSvgIconGenericLabel"),
    ...ai("svg-element-warning", "svgGenericDescription"),
    ...ibm("img_alt_misuse", "media_alt_brief"),
  ]],
  ["image-redundant-alt", "Image text should not repeat adjacent text", "Flags images whose alternative text duplicates the link or surrounding text.", "If the image repeats nearby text, make it decorative (alt=\"\"); otherwise give it distinct alternative text.", ["1.1.1"], [
    ...ibm("img_alt_redundant"),
    ...axe("image-redundant-alt"),
  ]],
  ["image-decorative", "Decorative images must be hidden consistently", "Checks images marked as decorative that still carry a role, label or title, or are hidden in a conflicting way.", "For a decorative image use alt=\"\" (or role=\"presentation\") without aria-label or title; for an informative one remove aria-hidden and give it alt text.", ["1.1.1"], [
    ...ai("img-element-error", "imgRoleImgAriaHidden"),
    ...ibm("img_alt_null", "img_alt_decorative"),
  ]],
  ["image-decorative-review", "Confirm that graphics marked decorative really are", "Lists images and canvases that are hidden or described, so a person can confirm the choice.", "Check each graphic: if it conveys information, give it a text alternative; if not, keep it hidden from assistive technology.", ["1.1.1"], [
    ...ai("img-element-warning", "imgDecorative"),
    ...ai("canvas-element-warning", "canvasDecorative", "canvasHasDescription"),
  ]],
  ["image-src", "Images should have a source", "Flags img elements without a src attribute.", "Give every img a src, or remove the element.", BP, [
    ...ai("img-element-warning", "imgMissingSrc"),
  ]],
  ["input-image-alt", "Image buttons must have a text alternative", "Checks input type=\"image\" controls for alternative text.", "Add an alt attribute that names the action, e.g. alt=\"Search\".", ["1.1.1", "4.1.2"], [
    ...ai("input-element-error", "inputTypeImageMissingAlt"),
    ...ibm("imagebutton_alt_exists"),
    ...axe("input-image-alt"),
  ]],
  ["area-alt", "Image map areas must have a text alternative", "Checks that image maps and their area elements have alternative text.", "Add alt text to every area that describes its link destination.", ["1.1.1", "2.4.4", "4.1.2"], [
    ...ai("area-element-error", "areaMissingAltAttribute", "areaEmptyAlt"),
    ...ibm("area_alt_exists", "imagemap_alt_exists"),
    ...axe("area-alt"),
  ]],
  ["area-href", "Image map areas must be links", "Flags area elements without an href, which keyboard users cannot reach.", "Give each area an href, or remove it from the map.", ["2.1.1"], [
    ...ai("area-element-error", "areaMissingHrefAttribute"),
  ]],
  ["image-map-structure", "Image maps should be well formed", "Checks that map elements have a name and contain areas.", "Give the map a non-empty name that the image's usemap references, and add its area elements.", BP, [
    ...ai("map-element-error", "mapMissingNameAttribute", "mapAreaChildren", "mapEmptyNameAttribute"),
  ]],
  ["server-side-image-map", "Server-side image maps must not be used", "Flags images with the ismap attribute.", "Use a client-side image map (map/area) or ordinary links instead.", ["1.1.1", "2.1.1"], [
    ...ibm("img_ismap_misuse"),
    ...axe("server-side-image-map"),
  ]],
  ["image-longdesc", "Long descriptions must point to HTML content", "Checks that longdesc references a document.", "Point longdesc at an HTML page, or describe the image in visible text or with aria-describedby.", ["1.1.1"], [
    ...ibm("img_longdesc_misuse"),
  ]],
  ["role-img-alt", "Elements with an image role must have a text alternative", "Checks role=\"img\" elements and icon elements exposed as images.", "Add aria-label or aria-labelledby that describes the image.", ["1.1.1"], [
    ...ai("img-element-error", "iconMissingAccessibleName"),
    ...ai("button-element-error", "buttonIconMissingLabel"),
    ...ibm("aria_img_labelled"),
    ...axe("role-img-alt"),
  ]],
  ["icon-role", "Icon elements should be exposed as images or hidden", "Flags icon elements (e.g. <i>) that are neither hidden nor given an image role.", "Add role=\"img\" with a label to informative icons, or aria-hidden=\"true\" to decorative ones.", BP, [
    ...ai("img-element-warning", "iconMissingRoleImg"),
    ...ai("button-element-error", "buttonIconMissingRole"),
  ]],
  ["svg-img-alt", "SVG images must have a text alternative", "Checks informative SVG graphics for an accessible name.", "Add a <title> child, aria-label or aria-labelledby to the SVG, or hide it with aria-hidden=\"true\" if it is decorative.", ["1.1.1"], [
    ...ai("svg-element-error", "svgMissingName"),
    ...ai("svg-element-warning", "svgRoleImgNoDescription"),
    ...ai("button-element-error", "buttonSvgMissingLabel"),
    ...ai("a-element-error", "linkSvgMissingAccessibleName"),
    ...ibm("svg_graphics_labelled", "aria_graphic_labelled"),
    ...axe("svg-img-alt"),
  ]],
  ["svg-role", "Informative SVG should have an image role", "Flags labelled or informative SVG elements without role=\"img\" (or a graphics role).", "Add role=\"img\" to SVG graphics that carry meaning.", BP, [
    ...ai("svg-element-warning", "svgMissingRole", "svgShouldHaveRoleImg", "svgAriaLabelNoRole"),
    ...ai("button-element-error", "buttonSvgMissingRoleImg"),
  ]],
  ["object-alt", "Embedded objects must have a text alternative", "Checks object elements for an accessible name or fallback content.", "Add aria-label, aria-labelledby or meaningful fallback content inside the object.", ["1.1.1"], [
    ...ai("object-element-error", "objectMissingFallbackContent"),
    ...ibm("object_text_exists"),
    ...axe("object-alt"),
  ]],
  ["embed-alt", "Embedded content must have a text alternative", "Checks embed and noembed content for a text alternative.", "Give the embed an accessible name (aria-label or title) and provide an equivalent alternative.", ["1.1.1"], [
    ...ai("embed-element-error", "embedMissingAccessibleName"),
    ...ibm("embed_alt_exists", "noembed_content_exists"),
  ]],
  ["embed-type", "Embedded content should declare its type", "Flags object and embed elements without a type attribute.", "Add a type attribute with the MIME type of the embedded resource.", BP, [
    ...ai("object-element-error", "objectMissingTypeAttribute"),
    ...ai("embed-element-error", "embedMissingTypeAttribute"),
  ]],
  ["applet-alt", "Applets must have a text alternative", "Checks legacy applet elements for alternative text and content.", "Replace the applet, or provide alt text and equivalent inner content.", ["1.1.1"], [
    ...ibm("applet_alt_exists"),
  ]],
  ["canvas-alt", "Canvas graphics must have a text alternative", "Checks that informative canvas elements expose an image role and a description.", "Add role=\"img\" and aria-label (or fallback content) that describes what the canvas shows.", ["1.1.1"], [
    ...ai("canvas-element-error", "canvasMissingRoleImg"),
    ...ai("canvas-element-warning", "canvasMissingDescription"),
    ...ibm("canvas_content_described"),
  ]],
  ["figure-caption", "Figures should have a caption", "Flags figure elements without a figcaption or label.", "Add a figcaption, or label the figure with aria-label / aria-labelledby.", BP, [
    ...ai("figure-element-error", "figureMissingFigcaption"),
    ...ibm("figure_label_exists"),
  ]],
  ["background-image-alt", "Information must not rely on CSS background images", "Flags CSS background images that may convey information without a text equivalent.", "Provide the information as text or as an img with alt text; keep CSS backgrounds decorative.", ["1.1.1"], [
    ...ibm("img_alt_background", "style_background_decorative"),
  ]],
  ["text-graphics-alt", "ASCII art and emoticons need a text alternative", "Flags text drawings and emoticons that screen readers read character by character.", "Wrap them in an element with role=\"img\" and an aria-label describing the meaning.", ["1.1.1"], [
    ...ibm("asciiart_alt_exists", "emoticons_alt_exists"),
  ]],
  ["media-alt", "Audio and video need a short text alternative", "Checks media elements for a short description of their content.", "Label the media (aria-label or a nearby caption) with a short description of what it contains.", ["1.1.1"], [
    ...ibm("media_alt_exists"),
  ]],

  // ── Time-based media ──
  ["video-caption", "Videos must have captions", "Checks video elements for a captions track.", "Add a <track kind=\"captions\"> with synchronized captions for all speech and important sounds.", ["1.2.2"], [
    ...ai("media-element-error", "videoElementMissingCaptions"),
    ...ibm("caption_track_exists"),
    ...axe("video-caption"),
  ]],
  ["audio-transcript", "Audio must have a text alternative", "Checks audio content for a transcript or captions.", "Provide a transcript next to the audio (or a captions track).", ["1.2.1"], [
    ...ai("media-element-error", "audioElementMissingTranscript"),
    ...ibm("media_audio_transcribed"),
    ...axe("audio-caption"),
  ]],
  ["audio-description", "Videos must describe important visual content", "Checks videos for an audio description or a full text alternative.", "Add a descriptions track or an audio-described version, or a transcript that covers the visual information.", ["1.2.3", "1.2.5"], [
    ...ai("media-element-error", "videoElementMissingAudioDescription"),
    ...ai("media-element-warning", "videoCaptionsWithoutDescriptions"),
    ...ibm("media_track_available"),
  ]],
  ["live-captions", "Live media must have captions", "Flags live audio/video streams that need real-time captions.", "Provide real-time captions for live streams with audio.", ["1.2.4"], [
    ...ibm("media_live_captioned"),
  ]],
  ["track-valid", "Text tracks must be complete", "Checks track elements for src, kind and srclang.", "Give each track a src, a kind (captions, subtitles, descriptions) and a srclang for subtitles.", ["1.2.2"], [
    ...ai("track-element-error", "trackMissingSrcAttribute", "trackMissingKindAttribute", "trackMissingSrclangSubtitles"),
  ]],
  ["media-autoplay", "Media must not play sound automatically", "Flags audio or video that starts playing on its own.", "Remove autoplay, start muted, or give users a control to pause and adjust volume within 3 seconds.", ["1.4.2"], [
    ...ai("media-element-warning", "mediaElementAutoplay"),
    ...ibm("media_autostart_controllable"),
    ...axe("no-autoplay-audio"),
  ]],
  ["media-keyboard", "Media controls must work with a keyboard", "Checks that audio and video players can be operated without a mouse.", "Use native controls or make every custom control a focusable button.", ["2.1.1"], [
    ...ibm("media_keyboard_controllable"),
  ]],
  ["media-role", "Media with native controls should keep their role", "Flags audio/video elements with controls whose role is overridden.", "Remove the role attribute from media elements that use native controls.", ["4.1.2"], [
    ...ai("media-element-warning", "mediaRoleWithControls"),
  ]],
  ["content-hidden", "Meaningful content must not be hidden from assistive technology", "Flags landmarks, dialogs, lists, media, frames and icons hidden with aria-hidden or a presentational role.", "Remove aria-hidden=\"true\" / role=\"presentation\" from content that users need, or hide it visually as well.", ["1.3.1", "4.1.2"], [
    ...ai("details-element-warning", "detailsAriaHidden"),
    ...ai("dialog-element-warning", "dialogAriaHidden"),
    ...ai("landmark-element-warning", "landmarkAriaHidden"),
    ...ai("list-element-warning", "listAriaHidden"),
    ...ai("media-element-warning", "audioAriaHidden", "videoAriaHidden"),
    ...ai("object-element-warning", "objectAriaHidden"),
    ...ai("map-element-warning", "mapAriaHidden"),
    ...ai("heading-element-warning", "headingHiddenOrPresentation"),
    ...ai("iframe-element-warning", "iframeHidden"),
    ...ai("button-element-error", "buttonSvgHiddenFromAT", "buttonIconHiddenFromAT"),
  ]],
  ["aria-hidden-body", "The page body must not be hidden", "Checks that aria-hidden=\"true\" is not set on the body.", "Remove aria-hidden from the body element.", ["1.3.1", "4.1.2"], [
    ...axe("aria-hidden-body"),
  ]],

  // ── Moving content, timing ──
  ["no-blink", "Content must not blink", "Flags the blink element and text-decoration: blink.", "Remove blinking, or let users stop it within five seconds.", ["2.2.2"], [
    ...ai("distracting-element-error", "noBlink"),
    ...ibm("blink_elem_deprecated", "blink_css_review"),
    ...axe("blink"),
  ]],
  ["no-marquee", "Scrolling marquees must not be used", "Flags the obsolete marquee element.", "Replace the marquee with static content, or an animation users can pause.", ["2.2.2"], [
    ...ai("distracting-element-error", "noMarquee"),
    ...ibm("marquee_elem_avoid"),
    ...axe("marquee"),
  ]],
  ["meta-refresh", "Pages must not refresh or redirect on a timer", "Flags meta refresh with a delay.", "Remove the timed refresh, or redirect on the server; let users control any time limit.", ["2.2.1"], [
    ...ai("meta-element-warning", "metaRefreshTimeout"),
    ...ibm("meta_refresh_delay", "meta_redirect_optional"),
    ...axe("meta-refresh"),
  ]],
  ["meta-refresh-no-exceptions", "Pages should not refresh automatically at all", "Flags any meta refresh (stricter, AAA).", "Remove meta refresh; update content only when the user asks.", ["2.2.4", "3.2.5"], [
    ...ai("meta-element-warning", "metaRefreshDetected"),
    ...axe("meta-refresh-no-exceptions"),
  ]],

  // ── Zoom, reflow, spacing, orientation ──
  ["meta-viewport", "Zooming must not be disabled", "Checks the viewport meta tag for user-scalable=no or a low maximum-scale.", "Remove user-scalable=no and set maximum-scale to at least 2 (or leave it out).", ["1.4.4"], [
    ...ai("meta-element-error", "metaViewportDisablesZoom", "viewportUserScalableNo", "viewportMaxScaleLow"),
    ...ibm("meta_viewport_zoomable"),
    ...axe("meta-viewport"),
  ]],
  ["meta-viewport-large", "Users should be able to zoom to 500%", "Flags a viewport maximum-scale below 5.", "Allow maximum-scale of 5 or more, or leave it out.", BP, [
    ...axe("meta-viewport-large"),
  ]],
  ["text-resize", "Text must scale up to 200%", "Flags fixed sizing that may clip content when text is enlarged or the viewport narrows.", "Use relative units and flexible layouts; test at 200% zoom and 320px width.", ["1.4.4", "1.4.10"], [
    ...ibm("style_viewport_resizable"),
  ]],
  ["text-spacing", "Text spacing must be adjustable", "Flags inline !important letter/word spacing or line height.", "Don't lock text spacing with inline !important styles.", ["1.4.12"], [
    ...ibm("text_spacing_valid"),
    ...axe("avoid-inline-spacing"),
  ]],
  ["orientation-lock", "Content must not be locked to one orientation", "Flags CSS that forces portrait or landscape display.", "Let the layout adapt to both orientations unless one is essential.", ["1.3.4"], [
    ...ibm("element_orientation_unlocked"),
    ...axe("css-orientation-lock"),
  ]],
  ["hover-content", "Content shown on hover must stay reachable", "Flags hover content the pointer may not be able to move onto.", "Keep hover/focus popups open while the pointer is over them, dismissible with Escape, and persistent until dismissed.", ["1.4.13"], [
    ...ibm("style_hover_persistent"),
  ]],

  // ── Colour and contrast ──
  ["color-contrast", "Text must have sufficient color contrast", "Measures the contrast between text and its background (4.5:1, or 3:1 for large text).", "Darken the text or lighten the background (or vice versa) until the ratio meets 4.5:1 (3:1 for large text).", ["1.4.3"], [
    ...ibm("text_contrast_sufficient"),
    ...axe("color-contrast"),
  ]],
  ["color-contrast-enhanced", "Text should have enhanced color contrast", "Measures contrast against the AAA thresholds (7:1, or 4.5:1 for large text).", "Increase the contrast to 7:1 (4.5:1 for large text).", ["1.4.6"], [
    ...axe("color-contrast-enhanced"),
  ]],
  ["use-of-color", "Color must not be the only visual cue", "Flags styling where color alone may carry meaning (e.g. required fields).", "Add text, an icon or another visual marker in addition to color.", ["1.4.1"], [
    ...ibm("style_color_misuse", "form_font_color"),
  ]],
  ["link-in-text-block", "Links in text must be distinguishable without color", "Checks that links inside paragraphs differ from surrounding text by more than color.", "Underline links in running text, or give them a 3:1 contrast with the text plus a non-color cue on focus/hover.", ["1.4.1"], [
    ...axe("link-in-text-block"),
  ]],
  ["forced-colors", "Content must remain visible in high contrast mode", "Flags CSS-rendered content that may disappear in forced-colors (high contrast) mode.", "Test in Windows high contrast / forced colors and use real elements or system colors for meaningful content.", ["1.1.1", "1.3.2", "1.4.11"], [
    ...ibm("style_highcontrast_visible"),
  ]],

  // ── Headings and structure ──
  ["heading-order", "Heading levels should increase by one", "Flags skipped heading levels (e.g. h2 followed by h4).", "Use the next heading level down (h2 → h3) so the outline has no gaps.", ["1.3.1"], [
    ...ai("heading-element-error", "headingLevelSkipped"),
    ...axe("heading-order"),
  ]],
  ["empty-heading", "Headings must have text", "Flags headings with no text or only an image without alt text.", "Put descriptive text in the heading, or remove the empty heading.", ["1.3.1", "2.4.6"], [
    ...ai("heading-element-error", "headingEmpty"),
    ...ai("heading-element-warning", "headingOnlyImageNoAlt"),
    ...ibm("heading_content_exists"),
    ...axe("empty-heading"),
  ]],
  ["heading-nested", "Headings must not contain other headings", "Flags a heading element nested inside another heading.", "Split the nested headings into separate, sibling elements.", ["1.3.1"], [
    ...ai("heading-element-error", "headingNested"),
  ]],
  ["heading-level", "Heading roles must declare a level", "Flags role=\"heading\" without aria-level.", "Add aria-level (1-6), or use a native h1-h6 element.", ["1.3.1"], [
    ...ai("heading-element-warning", "headingRoleMissingAriaLevel"),
  ]],
  ["heading-one", "Pages should have one level-one heading", "Checks for a single h1 describing the page.", "Give the page exactly one h1 that names its main content.", BP, [
    ...ai("heading-element-warning", "multipleH1"),
    ...axe("page-has-heading-one"),
  ]],
  ["heading-misuse", "Heading markup must not be used for styling", "Flags headings used only to make text large or bold.", "Use CSS for visual styling and keep heading elements for real section titles.", ["1.3.1"], [
    ...ibm("heading_markup_misuse"),
  ]],
  ["visual-heading", "Text that looks like a heading must be marked up as one", "Flags styled paragraphs that act as headings.", "Use an h1-h6 element (or role=\"heading\" with aria-level) for visual headings.", ["1.3.1"], [
    ...ibm("text_block_heading"),
    ...axe("p-as-heading"),
  ]],
  ["section-heading", "Sections should have a heading", "Flags section elements without a heading or accessible name.", "Start each section with a heading, or label it with aria-labelledby.", BP, [
    ...ai("section-element-warning", "sectionHaveHeading"),
  ]],
  ["css-generated-content", "Meaningful content must not come only from CSS", "Flags ::before/::after content that may carry information.", "Put meaningful text in the HTML; keep CSS-generated content decorative.", ["1.3.1"], [
    ...ibm("style_before_after_review"),
  ]],
  ["meaningful-sequence", "Reading order must match the visual order", "Flags markup whose programmatic order may not match its presentation (direction, whitespace used for layout).", "Use valid dir values and CSS for spacing so the DOM reads in a meaningful order.", ["1.3.2"], [
    ...ibm("dir_attribute_valid", "text_whitespace_valid"),
  ]],
  ["sensory-characteristics", "Instructions must not rely only on shape, size or position", "Flags instructions such as \"click the round button on the right\".", "Name the control in the instruction as well as describing its position or look.", ["1.3.3"], [
    ...ibm("text_sensory_misuse"),
  ]],
  ["quote-markup", "Quotations must use quotation markup", "Flags quotes without q/blockquote and blockquote used for indentation.", "Use q or blockquote only for quotations, and CSS for indentation.", ["1.3.1"], [
    ...ibm("text_quoted_correctly", "blockquote_cite_exists"),
  ]],
  ["blockquote-cite", "Block quotations should cite their source", "Flags blockquote elements without a cite attribute.", "Add a cite URL, or name the source in the text.", BP, [
    ...ai("blockquote-element-warning", "blockquoteHaveCiteAttributeAttribution"),
  ]],
  ["obsolete-html", "Obsolete HTML should not be used", "Flags deprecated elements and attributes.", "Replace obsolete markup with modern HTML and CSS.", BP, [
    ...ibm("element_attribute_deprecated"),
  ]],
  ["details-summary", "Disclosure widgets must be well formed", "Checks details/summary pairing.", "Put a summary as the first child of every details element, and use summary only inside details.", ["1.3.1"], [
    ...ai("details-element-error", "detailsElementMissingSummaryChild", "summaryElementInsideDetails"),
  ]],
  ["separator-role", "Separators should be exposed or hidden deliberately", "Flags hr elements without role=\"separator\" or a presentational role.", "Keep the implicit separator or add role=\"presentation\" if the rule is decorative.", BP, [
    ...ai("hr-element-warning", "hrHaveRoleSeparatorPresentation"),
  ]],
  ["time-datetime", "Time elements should have a machine-readable value", "Flags time elements without datetime.", "Add a datetime attribute in a valid date/time format.", BP, [
    ...ai("time-element-error", "timeElementMissingDatetimeAttribute"),
  ]],

  // ── Lists ──
  ["list", "Lists must be structured correctly", "Checks that ul/ol contain only li items and li items are inside a list.", "Place li elements directly inside ul/ol (or role=\"list\"), and move other content out of the list.", ["1.3.1"], [
    ...ai("list-element-error", "liOrphan", "listNoItems", "listEmptyItem", "liNestedInLi"),
    ...ai("list-element-warning", "listInvalidChildren", "listInvalidElement"),
    ...axe("list", "listitem"),
  ]],
  ["list-markup", "Lists of items should use list markup", "Flags content that looks like a list, and lists used for non-list content.", "Use ul/ol/li for real lists, and don't use list markup purely for layout.", ["1.3.1"], [
    ...ibm("list_markup_review", "list_structure_proper"),
  ]],
  ["definition-list", "Definition lists must be structured correctly", "Checks dl, dt and dd nesting and order.", "Put dt/dd groups directly inside dl (optionally wrapped in div), starting with dt and with no empty items.", ["1.3.1"], [
    ...ai("dl-element-error", "dlContainsInvalidChildren", "dtDdInsideDl", "dtNotFirstChildOfDl", "dlMissingDdElement", "dlEmptyTerm"),
    ...axe("definition-list", "dlitem"),
  ]],

  // ── Tables ──
  ["table-headers", "Data tables must have header cells", "Checks data tables for th cells or header roles, and complex tables for header associations.", "Mark header cells with th (and scope), or relate cells with headers/id in complex tables.", ["1.3.1"], [
    ...ai("table-element-error", "tableMissingTh", "tableMissingHeaders"),
    ...ibm("table_headers_exists", "table_headers_related"),
    ...axe("td-has-header"),
  ]],
  ["empty-table-header", "Table headers must have text", "Flags th cells without content.", "Put text in every header cell (it can be visually hidden), or use td for empty cells.", ["1.3.1"], [
    ...ai("table-element-error", "tableEmptyHeader"),
    ...axe("empty-table-header"),
  ]],
  ["table-headers-attr", "Header references in tables must be valid", "Checks that headers attributes point to th cells of the same table, and headers have data cells.", "Fix headers attributes so they list ids of header cells in the same table.", ["1.3.1"], [
    ...ibm("table_headers_ref_valid"),
    ...axe("td-headers-attr", "th-has-data-cells"),
  ]],
  ["scope-attr-valid", "The scope attribute must be valid", "Checks scope values and their use on header cells.", "Use scope=\"col\", \"row\", \"colgroup\" or \"rowgroup\" on th elements only.", ["1.3.1"], [
    ...ai("scope-element-error", "invalidScopeValue"),
    ...ibm("table_scope_valid"),
    ...axe("scope-attr-valid"),
  ]],
  ["th-scope", "Header cells should declare their scope", "Flags th cells without a scope attribute.", "Add scope=\"col\" or scope=\"row\" to header cells.", BP, [
    ...ai("scope-element-error", "thMissingScopeAttribute"),
  ]],
  ["table-caption", "Data tables should have a caption", "Flags data tables without a caption, and the deprecated summary attribute.", "Add a caption element that names the table.", BP, [
    ...ai("table-element-error", "tableMissingCaptionSummary", "tableMissingCaption", "tableDeprecatedSummary"),
  ]],
  ["table-caption-valid", "Table captions must be real and non-empty", "Checks caption placement and content, and cells faking a caption.", "Use a non-empty caption as the first child of the table instead of a spanning cell.", ["1.3.1"], [
    ...ibm("table_caption_empty", "table_caption_nested"),
    ...axe("table-fake-caption"),
  ]],
  ["table-duplicate-name", "Table summary and caption should differ", "Flags tables whose summary repeats the caption.", "Make the caption the title and remove the duplicate summary.", ["1.3.1"], [
    ...ai("table-element-warning", "tableSummaryCaptionMatch"),
    ...ibm("table_summary_redundant"),
    ...axe("table-duplicate-name"),
  ]],
  ["table-structure", "Table cells and rows must be nested correctly", "Checks that td/th are inside tr, and tr inside a table section.", "Nest cells in rows and rows in table/thead/tbody/tfoot.", ["1.3.1"], [
    ...ai("table-element-error", "tdMissingTrParent", "thMissingTrParent", "trMissingTableParent"),
  ]],
  ["layout-table", "Layout tables must not use data-table markup", "Flags presentational tables with headers or captions, and layout tables that may not linearize.", "Use CSS for layout; if a layout table is unavoidable, drop th/caption/summary and keep a logical reading order.", ["1.3.1"], [
    ...ai("table-element-warning", "tableRolePresentation"),
    ...ibm("table_structure_misuse", "table_layout_linearized"),
  ]],
  ["table-role-override", "Table parts must not override their roles", "Flags explicit roles on table structure elements.", "Remove role attributes from tr, td, th and table sections inside a table.", ["4.1.2"], [
    ...ibm("table_aria_descendants"),
  ]],

  // ── Page, language, landmarks, bypass ──
  ["document-title", "Pages must have a title", "Checks for a non-empty title element.", "Add a title that describes the page's topic or purpose.", ["2.4.2"], [
    ...ai("title-element-error", "pageMissingTitleElement", "titleElementEmpty"),
    ...ibm("page_title_exists"),
    ...axe("document-title"),
  ]],
  ["document-title-descriptive", "Page titles must be descriptive", "Flags titles that look like a file name.", "Use a meaningful title, e.g. \"Checkout – Shop\" rather than \"index.html\".", ["2.4.2"], [
    ...ibm("page_title_valid"),
  ]],
  ["html-has-lang", "The page must declare its language", "Checks the html element for a lang attribute.", "Add lang to the html element, e.g. <html lang=\"en\">.", ["3.1.1"], [
    ...ai("lang-element-error", "htmlElementMissingLangAttribute"),
    ...ibm("html_lang_exists"),
    ...axe("html-has-lang"),
  ]],
  ["html-lang-valid", "The page language must be a valid code", "Checks that lang (and xml:lang) on html are valid, matching BCP 47 codes.", "Use a valid language tag such as en, en-GB or de, and keep lang and xml:lang identical.", ["3.1.1"], [
    ...ai("lang-element-error", "invalidLangAttributeValue", "emptyLangAttribute"),
    ...ibm("html_lang_valid"),
    ...axe("html-lang-valid", "html-xml-lang-mismatch"),
  ]],
  ["valid-lang", "Language changes must use valid codes", "Checks lang attributes on elements inside the page.", "Use a valid BCP 47 language tag on elements whose language differs from the page.", ["3.1.2"], [
    ...ibm("element_lang_valid"),
    ...axe("valid-lang"),
  ]],
  ["abbreviation", "Abbreviations should be expanded", "Flags abbr elements without a title.", "Add a title with the expansion, or spell it out on first use.", ["3.1.4"], [
    ...ai("abbr-element-error", "abbrElementMissingTitleAttribute"),
  ]],
  ["ruby-annotation", "Ruby annotations should be complete", "Checks ruby elements for rt and rp fallback.", "Add rt with the pronunciation and rp parentheses as fallback.", BP, [
    ...ai("ruby-element-error", "rubyMissingRtElement"),
    ...ai("ruby-element-warning", "rubyHaveRpFallback"),
  ]],
  ["bypass", "Pages must offer a way to skip repeated content", "Checks for a skip link, landmark or heading structure that lets users bypass repeated blocks.", "Add a \"Skip to main content\" link as the first focusable element and a main landmark.", ["2.4.1"], [
    ...ai("skip-link-warning", "pageHaveSkipLink"),
    ...ibm("html_skipnav_exists", "skip_main_exists"),
    ...axe("bypass"),
  ]],
  ["skip-link", "Skip links must work and say where they go", "Checks that skip links name and reach an existing, focusable target.", "Point the skip link at the id of the main content and describe the destination.", ["2.4.1"], [
    ...ibm("skip_main_described"),
    ...axe("skip-link"),
  ]],
  ["landmark-one-main", "Pages should have a main landmark", "Checks for a main landmark.", "Wrap the primary content in a main element.", BP, [
    ...ai("landmark-element-error", "pageHaveMainLandmark"),
    ...axe("landmark-one-main"),
  ]],
  ["landmark-no-duplicate", "Pages should not repeat unique landmarks", "Flags more than one main, banner or contentinfo landmark.", "Keep a single main, header (banner) and footer (contentinfo) at the top level.", BP, [
    ...ai("landmark-element-warning", "multipleMainLandmarksFound"),
    ...ibm("aria_banner_single", "aria_contentinfo_single"),
    ...axe("landmark-no-duplicate-banner", "landmark-no-duplicate-contentinfo", "landmark-no-duplicate-main"),
  ]],
  ["landmark-top-level", "Top-level landmarks should not be nested", "Flags banner, main, contentinfo and complementary landmarks inside other landmarks.", "Move these landmarks to the top level of the page.", BP, [
    ...ibm("aria_contentinfo_misuse"),
    ...axe("landmark-banner-is-top-level", "landmark-complementary-is-top-level", "landmark-contentinfo-is-top-level", "landmark-main-is-top-level"),
  ]],
  ["landmark-unique", "Landmarks of the same type should have unique names", "Flags landmarks and regions that share a role and name.", "Give each repeated landmark a distinct aria-label or aria-labelledby.", BP, [
    ...ibm(
      "aria_landmark_name_unique", "aria_banner_label_unique", "aria_complementary_label_unique", "aria_contentinfo_label_unique",
      "aria_form_label_unique", "aria_main_label_unique", "aria_navigation_label_unique", "aria_region_label_unique",
      "aria_search_label_unique", "aria_application_label_unique", "aria_article_label_unique", "aria_document_label_unique",
      "aria_toolbar_label_unique",
    ),
    ...axe("landmark-unique"),
  ]],
  ["landmark-name", "Landmarks and regions should be labelled", "Flags forms, regions, complementary and application areas without an accessible name.", "Label the landmark with aria-labelledby pointing at its visible heading, or aria-label.", BP, [
    ...ai("landmark-element-warning", "landmarkMissingAccessibleName"),
    ...ai("form-element-error", "formMissingAccessibleName"),
    ...ai("section-element-warning", "sectionHaveAccessibleName"),
    ...ibm("aria_complementary_labelled", "aria_region_labelled", "aria_application_labelled", "aria_complementary_label_visible", "aria_main_label_visible"),
  ]],
  ["region", "Page content should be inside landmarks", "Flags content outside any landmark region.", "Place all content inside header, nav, main, aside or footer landmarks.", BP, [
    ...ibm("aria_content_in_landmark"),
    ...axe("region"),
  ]],

  // ── Links ──
  ["link-name", "Links must have an accessible name", "Checks that every link exposes text, alt text or a label.", "Put descriptive text inside the link, or add aria-label; give images inside links alt text.", ["2.4.4", "4.1.2"], [
    ...ai("a-element-error", "linkAccessibleName"),
    ...ibm("a_text_purpose"),
    ...axe("link-name"),
  ]],
  ["link-purpose", "Link text must describe its destination", "Flags generic link text such as \"click here\" and raw URLs.", "Use link text that makes sense on its own, e.g. \"Read the returns policy\".", ["2.4.4"], [
    ...ai("a-element-warning", "linkTextGenericClickHere"),
    ...ai("a-element-error", "linkTextOnlyUrl"),
  ]],
  ["link-text-length", "Link text should be concise", "Flags link names longer than 150 characters.", "Shorten the link text and move extra detail outside the link.", BP, [
    ...ai("a-element-warning", "linkTextTooLong"),
  ]],
  ["link-href", "Links must have a real destination", "Flags links without href, empty or \"#\" hrefs, and scripts emulating links.", "Give links a real href, or use a button for actions.", ["2.1.1"], [
    ...ai("a-element-error", "linkMissingHrefAttribute", "linkHrefEmpty"),
    ...ibm("script_onclick_misuse", "script_onclick_avoid"),
  ]],
  ["link-new-window", "Users should be warned before a new window opens", "Flags links that open a new window or tab.", "Tell users in the link text or with an icon label (\"opens in a new tab\").", ["3.2.2"], [
    ...ibm("a_target_warning"),
  ]],
  ["identical-links-same-purpose", "Links with the same name should go to the same place", "Flags identically named links with different destinations (AAA).", "Give links with different destinations different names.", ["2.4.9"], [
    ...axe("identical-links-same-purpose"),
  ]],

  // ── Keyboard and focus ──
  ["keyboard-access", "Mouse interactions must have a keyboard equivalent", "Flags click or mouse handlers without keyboard handlers, and widgets without keyboard support.", "Use a native button or link, or add key handlers (Enter/Space) and a tabindex.", ["2.1.1"], [
    ...ai("click-handler-warning", "onclickWithoutOnkeydownOnkeyup", "mouseEventWithoutKeyboardEquivalent"),
    ...ibm("element_mouseevent_keyboard", "aria_keyboard_handler_exists"),
  ]],
  ["interactive-focusable", "Interactive elements must be focusable", "Flags widgets, sliders, role=link and aria-activedescendant containers that keyboard users cannot reach.", "Add tabindex=\"0\" to custom widgets (or use a native element) and make every widget reachable.", ["2.1.1"], [
    ...ai("focus-element-warning", "interactiveRoleNotFocusable"),
    ...ai("focus-element-error", "activedescendantNotFocusable"),
    ...ai("a-element-error", "roleLinkMissingTabindex"),
    ...ai("slider-element-warning", "sliderMissingTabindex"),
    ...ibm("aria_activedescendant_tabindex_valid", "widget_tabbable_exists", "aria_child_tabbable"),
  ]],
  ["widget-single-tabstop", "Composite widgets should have one tab stop", "Flags widgets with several tabbable parts.", "Keep one tabbable element per widget and move between its parts with arrow keys.", ["2.1.1", "2.4.3"], [
    ...ibm("widget_tabbable_single"),
  ]],
  ["focusable-removed", "Interactive content must not be removed from the tab order", "Flags links and frames with interactive content that have tabindex=\"-1\".", "Remove tabindex=\"-1\" from content that keyboard users need.", ["2.1.1"], [
    ...ai("a-element-warning", "linkTabindexNegative"),
    ...ibm("iframe_interactive_tabbable"),
    ...axe("frame-focusable-content"),
  ]],
  ["scrollable-region-focusable", "Scrollable regions must be keyboard accessible", "Flags scrolling containers that keyboard users cannot focus or scroll.", "Add tabindex=\"0\" (and a label) to the scroll container, or make sure it contains focusable content.", ["2.1.1"], [
    ...ibm("element_scrollable_tabbable"),
    ...axe("scrollable-region-focusable"),
  ]],
  ["download-keyboard", "File downloads must stay keyboard operable", "Flags download mechanisms that may trap or lose keyboard focus.", "Make downloads reachable and operable by keyboard, and return focus to where it was.", ["2.1.2"], [
    ...ibm("download_keyboard_controllable"),
  ]],
  ["tabindex", "Avoid positive tabindex values", "Flags tabindex greater than 0, which breaks the natural focus order.", "Use tabindex=\"0\" or rearrange the DOM so the order is logical.", ["2.4.3"], [
    ...ai("focus-element-warning", "positiveTabindexValueFound"),
    ...axe("tabindex"),
  ]],
  ["tabindex-redundant", "Avoid redundant tabindex", "Flags tabindex=\"0\" on elements that are already focusable.", "Remove the unnecessary tabindex.", BP, [
    ...ai("focus-element-error", "unnecessaryTabindex"),
  ]],
  ["no-autofocus", "Avoid moving focus on page load", "Flags the autofocus attribute.", "Let users start from the top of the page; move focus only in response to their action.", BP, [
    ...ai("autofocus-element-warning", "noAutofocus"),
  ]],
  ["focus-order", "Focus must move in a meaningful order", "Flags modal dialogs that don't keep focus inside and disabled controls that stay in the tab order.", "Trap focus inside open modals and take disabled controls out of the tab order.", ["2.4.3"], [
    ...ai("dialog-element-warning", "modalDialogTrapFocus"),
    ...ai("disabled-element-warning", "disabledElementTabOrder"),
  ]],
  ["focusable-role", "Focusable elements must have an interactive role", "Flags elements with tabindex or event handlers that expose no widget role.", "Use a native control, or add an appropriate role (button, link, checkbox, ...).", ["4.1.2"], [
    ...ai("focus-element-warning", "elementTabindexButRole"),
    ...ibm("element_tabbable_role_valid", "aria_eventhandler_role_valid"),
    ...axe("focus-order-semantics"),
  ]],
  ["focus-visible", "Keyboard focus must be visible", "Flags focusable elements whose focus indicator may be hidden or not visible.", "Keep a clearly visible :focus-visible outline on every focusable element.", ["2.4.7"], [
    ...ibm("element_tabbable_visible", "style_focus_visible"),
  ]],
  ["focus-not-obscured", "Focused elements must not be hidden by other content", "Flags focusable elements that may be covered by sticky headers, footers or overlays.", "Add scroll-padding / margins so focused elements stay at least partly visible.", ["2.4.11"], [
    ...ibm("element_tabbable_unobscured"),
  ]],
  ["focus-change", "Focus and selection must not change context unexpectedly", "Flags scripts that move focus away (blur) or change context on focus.", "Don't remove focus programmatically, and don't navigate or submit when a control merely receives focus.", ["2.1.1", "2.4.7", "3.2.1"], [
    ...ibm("script_focus_blur_review", "script_select_review"),
  ]],
  ["aria-hidden-focus", "Hidden content must not be focusable", "Flags focusable elements inside aria-hidden=\"true\" containers.", "Remove the focusable elements from the hidden container, or add tabindex=\"-1\" / inert.", ["4.1.2"], [
    ...ai("aria-element-warning", "ariaHiddenFocusableElement"),
    ...ibm("aria_hidden_nontabbable"),
    ...axe("aria-hidden-focus"),
  ]],
  ["aria-text", "role=\"text\" must not contain focusable content", "Flags role=\"text\" elements with focusable descendants.", "Remove role=\"text\" or the focusable descendants.", BP, [
    ...axe("aria-text"),
  ]],
  ["nested-interactive", "Interactive controls must not be nested", "Flags controls inside other controls, whose inner roles assistive technology ignores.", "Move the inner control out of the outer one.", ["4.1.2"], [
    ...ibm("aria_descendant_valid"),
    ...axe("nested-interactive"),
  ]],
  ["accesskeys", "Access keys should be unique", "Flags duplicate accesskey values.", "Give every accesskey a unique value, or remove them.", BP, [
    ...ai("accesskey-element-error", "duplicateAccesskey"),
    ...ibm("element_accesskey_unique"),
    ...axe("accesskeys"),
  ]],
  ["accesskey-label", "Elements with an access key must be labelled", "Flags accesskey elements without an associated label.", "Label the control so users know what the shortcut does.", ["3.3.2"], [
    ...ibm("element_accesskey_labelled"),
  ]],

  // ── Pointer, targets, input purpose ──
  ["target-size", "Touch targets must be large enough", "Checks that targets are at least 24×24 CSS pixels or have enough spacing.", "Make targets at least 24×24 px, or leave enough space around small ones.", ["2.5.8"], [
    ...ibm("target_spacing_sufficient"),
    ...axe("target-size"),
  ]],
  ["dragging-alternative", "Dragging must have a single-pointer alternative", "Flags draggable elements.", "Offer buttons or another single-click way to do what dragging does.", ["2.5.7"], [
    ...ibm("draggable_alternative_exists"),
  ]],
  ["label-in-name", "The accessible name must contain the visible label", "Checks that a control's accessible name includes its visible text.", "Start aria-label with the visible text (or drop the aria-label).", ["2.5.3"], [
    ...ibm("label_name_visible"),
    ...axe("label-content-name-mismatch"),
  ]],
  ["autocomplete-valid", "Autocomplete values must be valid", "Checks autocomplete tokens against the input's purpose.", "Use a valid autocomplete token that matches the field, e.g. email, given-name, postal-code.", ["1.3.5"], [
    ...ai("autocomplete-element-error", "invalidAutocompleteValue"),
    ...ibm("input_autocomplete_valid"),
    ...axe("autocomplete-valid"),
  ]],
  ["autocomplete-missing", "Personal data fields should declare their purpose", "Flags inputs without an autocomplete attribute.", "Add autocomplete with the matching token for fields that collect user data.", ["1.3.5"], [
    ...ai("autocomplete-element-warning", "inputHaveAutocompleteAttribute"),
  ]],

  // ── Forms ──
  ["label", "Form fields must have a label", "Checks inputs, selects and textareas for an associated label.", "Add a <label for> pointing at the field, wrap the field in a label, or use aria-labelledby.", ["1.3.1", "3.3.2", "4.1.2"], [
    ...ai("input-element-error", "inputMissingAssociatedLabel"),
    ...ai("textarea-element-error", "textareaMissingAssociatedLabel"),
    ...ai("select-element-error", "selectMissingAssociatedLabel"),
    ...ibm("input_label_exists"),
    ...axe("label", "select-name"),
  ]],
  ["label-visible", "Form fields should have a visible label", "Flags fields labelled only by a placeholder, title or hidden label.", "Show a persistent visible label; a placeholder disappears as soon as the user types.", ["2.5.3", "3.3.2"], [
    ...ai("input-element-warning", "inputPlaceholderLabelSubstitute"),
    ...ai("textarea-element-warning", "textareaPlaceholderLabelSubstitute"),
    ...ibm("input_label_visible", "input_placeholder_label_visible"),
    ...axe("label-title-only"),
  ]],
  ["label-position", "Labels should be placed where users expect them", "Flags labels after text fields or before checkboxes and radio buttons.", "Put labels before text inputs and selects, and after checkboxes and radio buttons.", ["3.3.2"], [
    ...ibm("input_label_before", "input_label_after"),
  ]],
  ["label-multiple", "Form fields should have exactly one label", "Flags fields with more than one label element.", "Keep a single label per field; add extra hints with aria-describedby.", ["1.3.1", "3.3.2"], [
    ...ibm("form_label_unique"),
    ...axe("form-field-multiple-labels"),
  ]],
  ["label-empty", "Labels must have text", "Flags label elements without text content.", "Put descriptive text in every label.", ["4.1.2"], [
    ...ai("label-element-error", "labelTextContent"),
    ...ibm("label_content_exists"),
  ]],
  ["label-for-valid", "Labels must point to a valid field", "Flags label elements without a for attribute or with one that references no form field.", "Set for to the id of the field, or wrap the field inside the label.", ["1.3.1"], [
    ...ai("label-element-error", "labelMissingAttribute"),
    ...ibm("label_ref_valid"),
  ]],
  ["group-label", "Related form controls must be grouped and labelled", "Checks fieldsets, legends and groups of checkboxes or radio buttons.", "Wrap related controls in a fieldset with a legend (or role=\"group\" with a label).", ["1.3.1", "3.3.2"], [
    ...ai("form-element-error", "fieldsetMissingLegend"),
    ...ibm("fieldset_legend_valid", "fieldset_label_valid", "input_checkboxes_grouped", "input_fields_grouped"),
  ]],
  ["select-structure", "Select lists should be complete", "Flags selects without options, unlabeled optgroups and options without values.", "Give every select its options, label each optgroup and give options a value.", BP, [
    ...ai("select-element-error", "selectOptions"),
    ...ai("optgroup-element-error", "optgroupMissingLabelAttribute", "optgroupEmptyLabel"),
    ...ai("selected-element-warning", "optionElementHaveValueAttribute"),
    ...ibm("select_options_grouped"),
  ]],
  ["form-field-attributes", "Form fields should have name and type attributes", "Flags inputs without type, and fields without name.", "Add type to inputs and name to every field that is submitted.", BP, [
    ...ai("input-element-error", "inputMissingTypeAttribute", "inputMissingNameAttribute"),
    ...ai("textarea-element-error", "textareaMissingNameAttribute"),
    ...ai("select-element-error", "selectMissingNameAttribute"),
    ...ai("checked-element-error", "checkboxRadioMissingNameAttribute"),
  ]],
  ["required-indicator", "Required fields must be indicated", "Flags required fields without a visible indicator.", "Mark required fields visibly (e.g. \"(required)\") as well as with the required attribute.", ["3.3.2"], [
    ...ai("required-element-warning", "requiredFieldHaveVisualIndicator"),
  ]],
  ["error-message", "Error messages must be linked to their field", "Checks aria-errormessage references and how errors are exposed.", "Reference an existing, visible error message with aria-errormessage (or aria-describedby) and set aria-invalid.", ["3.3.1"], [
    ...ibm("error_message_exists"),
  ]],
  ["form-submit", "Forms should have a submit button", "Flags forms without a submit control.", "Add a submit button so users decide when the form is sent.", ["3.2.2"], [
    ...ai("form-element-warning", "formHaveSubmitButton"),
    ...ibm("form_submit_button_exists"),
  ]],
  ["on-input", "Changing a value must not change context unexpectedly", "Flags forms and inputs that may submit, navigate or open windows on change.", "Only change context when the user activates a button, or warn them beforehand.", ["3.2.2"], [
    ...ibm("form_interaction_review", "input_onchange_review", "form_submit_review"),
  ]],
  ["input-list-conflict", "Inputs with a suggestion list must not override its popup", "Flags input elements combining list with aria-haspopup, or referencing an invalid datalist.", "Remove aria-haspopup from inputs with a list attribute, and point list at a datalist.", ["4.1.2"], [
    ...ibm("input_haspopup_conflict"),
  ]],
  ["output-name", "Output elements should have a name", "Flags output elements without an accessible name.", "Label the output with a label element or aria-label.", BP, [
    ...ai("output-element-error", "outputMissingAccessibleName"),
  ]],

  // ── Buttons and names of controls ──
  ["button-name", "Buttons must have an accessible name", "Checks buttons, input buttons and summary elements for a name.", "Put text in the button, or add aria-label; for icon buttons label the button, not only the icon.", ["4.1.2"], [
    ...ai("button-element-error", "buttonAccessibleName"),
    ...axe("button-name", "input-button-name", "summary-name"),
  ]],
  ["label-descriptive", "Labels should describe the control's purpose", "Flags generic button text and labels that may not be descriptive.", "Use specific wording such as \"Save address\" instead of \"Submit\" or \"OK\".", ["2.4.6"], [
    ...ai("button-element-warning", "buttonTextGeneric"),
    ...ai("slider-element-warning", "sliderHasName"),
  ]],
  ["control-name", "Interactive controls must have an accessible name", "Checks custom widgets (sliders, menus, tabs, toggles, tooltips, tree items ...) for a name.", "Label the widget with aria-label or aria-labelledby referencing visible text.", ["4.1.2"], [
    ...ai("slider-element-warning", "sliderMissingName", "sliderEmptyAriaLabel"),
    ...ai("menu-element-error", "menuItemRadioMissingAccessibleName", "menuItemCheckboxMissingAccessibleName", "menubarMissingAccessibleName"),
    ...ai("menu-element-warning", "menuMissingAccessibleName"),
    ...ibm("aria_widget_labelled", "aria_accessiblename_exists"),
    ...axe("aria-input-field-name", "aria-toggle-field-name", "aria-command-name", "aria-tooltip-name", "aria-tab-name", "aria-treeitem-name"),
  ]],
  ["meter-progress-name", "Meters and progress bars must have a name", "Checks meter and progressbar elements for an accessible name.", "Label the meter or progress bar with aria-label or aria-labelledby.", ["1.1.1", "4.1.2"], [
    ...ai("meter-element-error", "meterMissingAccessibleName"),
    ...ai("progress-element-error", "progressMissingAccessibleName"),
    ...axe("aria-meter-name", "aria-progressbar-name"),
  ]],
  ["dialog-name", "Dialogs must have an accessible name", "Checks dialog and alertdialog elements for a name.", "Label the dialog with aria-labelledby pointing at its title.", ["4.1.2"], [
    ...ai("dialog-element-error", "dialogMissingAccessibleName"),
    ...axe("aria-dialog-name"),
  ]],
  ["frame-title", "Frames must have an accessible name", "Checks iframe and frame elements for a non-empty title.", "Add a title that describes the frame's content.", ["4.1.2"], [
    ...ai("iframe-element-error", "iframeMissingTitle", "iframeEmptyTitle"),
    ...ibm("frame_title_exists"),
    ...axe("frame-title"),
  ]],
  ["frame-title-unique", "Frame titles should be unique", "Flags frames that share the same title.", "Give each frame a distinct title.", ["4.1.2"], [
    ...axe("frame-title-unique"),
  ]],
  ["frame-content", "Frame content must be accessible", "Flags frames containing non-HTML content.", "Make sure framed content is accessible HTML, or provide an accessible alternative.", ["2.4.1"], [
    ...ibm("frame_src_valid"),
  ]],
  ["frame-unchecked", "Frame content was not checked", "Lists frames whose documents the audit could not inspect.", "Open the framed page on its own and audit it separately.", BP, [
    ...axe("frame-tested"),
  ]],
  ["hidden-content-unchecked", "Hidden content was not checked", "Lists hidden content the audit could not evaluate.", "Reveal the content (open menus, tabs, dialogs) and audit again.", BP, [
    ...axe("hidden-content"),
  ]],
  ["application-role", "Content inside an application region must be accessible", "Flags static content inside role=\"application\", which screen readers may skip.", "Avoid role=\"application\" or make its content reachable through focusable, labelled widgets.", ["1.1.1", "2.1.1"], [
    ...ibm("application_content_accessible"),
  ]],
  ["presentation-conflict", "Presentational elements should really be ignored", "Flags elements with role=\"none\"/\"presentation\" that are focusable or carry global ARIA attributes.", "Remove the presentational role, or the tabindex and ARIA attributes.", BP, [
    ...axe("presentation-role-conflict"),
  ]],

  // ── ARIA ──
  ["aria-roles", "ARIA roles must be valid", "Checks role values against the ARIA specification.", "Use a valid, non-abstract ARIA role (check spelling), or remove the role attribute.", ["4.1.2"], [
    ...ai("aria-element-error", "invalidAriaRole"),
    ...ibm("aria_role_allowed"),
    ...axe("aria-roles"),
  ]],
  ["aria-allowed-role", "ARIA roles must suit the element", "Flags roles that are not allowed on the element (e.g. interactive roles on static elements and vice versa).", "Use a native element with the right semantics, or a role permitted on this element.", ["4.1.2"], [
    ...ai("aria-element-warning", "noninteractiveElementInteractiveRole", "interactiveElementNoninteractiveRole"),
    ...ibm("aria_role_valid"),
    ...axe("aria-allowed-role"),
  ]],
  ["aria-deprecated", "Deprecated ARIA must not be used", "Flags deprecated ARIA roles and attributes.", "Replace deprecated roles/attributes with their current equivalents.", ["4.1.2"], [
    ...ibm("aria_attribute_deprecated"),
    ...axe("aria-deprecated-role"),
  ]],
  ["aria-redundant", "Avoid redundant ARIA", "Flags roles and ARIA attributes that repeat the element's native semantics.", "Remove the redundant role or attribute.", BP, [
    ...ai("aria-element-warning", "ariaRoleRedundant"),
    ...ai("list-element-warning", "listRedundantRoleList", "listitemRedundantRole"),
    ...ibm("aria_role_redundant", "aria_attribute_redundant"),
  ]],
  ["prefer-semantic-html", "Prefer native HTML elements over ARIA roles", "Flags ARIA roles that have a native HTML equivalent.", "Use the native element (e.g. <button> instead of role=\"button\").", BP, [
    ...ai("aria-element-warning", "preferSemanticElement"),
  ]],
  ["aria-valid-attr", "ARIA attribute names must be valid", "Flags unknown aria-* attributes.", "Fix the spelling or remove the attribute.", ["4.1.2"], [
    ...ai("aria-element-error", "ariaInvalidProp"),
    ...axe("aria-valid-attr"),
  ]],
  ["aria-valid-attr-value", "ARIA attribute values must be valid", "Checks ARIA state and property values (true/false/mixed, tokens, numbers, id references).", "Use an allowed value, e.g. aria-expanded=\"true\" or \"false\".", ["4.1.2"], [
    ...ai("aria-element-warning", "ariaInvalidPropValue"),
    ...ai("checked-element-warning", "ariaCheckedTrueFalseMixed"),
    ...ai("disabled-element-warning", "ariaDisabledTrueFalse"),
    ...ai("expanded-element-warning", "ariaExpandedTrueFalse"),
    ...ai("pressed-element-warning", "ariaPressedTrueFalseMixed"),
    ...ai("selected-element-warning", "ariaSelectedTrueFalse"),
    ...ai("orientation-element-error", "invalidAriaOrientationValue"),
    ...ai("live-region-error", "invalidAriaLiveValue"),
    ...ibm("aria_attribute_value_valid"),
    ...axe("aria-valid-attr-value"),
  ]],
  ["aria-allowed-attr", "ARIA attributes must be allowed for the role", "Flags ARIA attributes that the element's role does not support or prohibits.", "Remove the attribute, or change the role to one that supports it.", ["4.1.2"], [
    ...ai("role-props-element-warning", "roleUnsupportedProp"),
    ...ibm("aria_attribute_allowed", "aria_attribute_valid"),
    ...axe("aria-allowed-attr", "aria-prohibited-attr", "aria-conditional-attr"),
  ]],
  ["aria-required-attr", "Required ARIA attributes must be present", "Checks that roles have their required states and properties (e.g. aria-checked on menuitemcheckbox).", "Add the missing attribute with a valid, non-empty value.", ["4.1.2"], [
    ...ai("role-props-element-error", "roleMissingRequiredProp"),
    ...ai("menu-element-error", "menuItemRadioMissingAriaChecked", "menuItemCheckboxMissingAriaChecked"),
    ...ibm("aria_attribute_required", "aria_attribute_exists"),
    ...axe("aria-required-attr"),
  ]],
  ["aria-empty-attr", "ARIA labels and descriptions must not be empty", "Flags empty aria-label and aria-description attributes.", "Fill in the attribute or remove it.", ["4.1.2"], [
    ...ai("aria-element-error", "emptyAriaLabelAttribute"),
    ...ai("description-element-error", "ariaDescriptionEmpty"),
  ]],
  ["aria-valid-reference", "ARIA references must point to existing elements", "Flags aria-describedby, aria-controls and similar attributes whose ids don't exist, and duplicate ids used in references.", "Reference unique ids of elements that exist on the page.", ["4.1.2"], [
    ...ai("description-element-warning", "elementAriaDescribedbyReferencesNon"),
    ...ai("expanded-element-warning", "ariaControlsReferencesNonExistent"),
    ...ibm("aria_id_unique", "aria_activedescendant_valid"),
    ...axe("duplicate-id-aria"),
  ]],
  ["aria-attr-conflict", "ARIA attributes must not contradict HTML attributes", "Flags ARIA states that conflict with the equivalent HTML attribute.", "Keep only the HTML attribute, or make both agree.", ["4.1.2"], [
    ...ibm("aria_attribute_conflict"),
  ]],
  ["aria-range-values", "Range widgets should expose their limits", "Flags sliders, spin buttons, progress bars, scrollbars and meters without min/max values.", "Add aria-valuemin / aria-valuemax (or min / max) with meaningful numbers.", BP, [
    ...ai(
      "slider-element-warning",
      "sliderMissingValuemin", "sliderEmptyValuemin", "sliderMissingValuemax", "sliderEmptyValuemax",
      "scrollbarMissingValuemin", "scrollbarEmptyValuemin", "scrollbarMissingValuemax", "scrollbarEmptyValuemax",
      "spinbuttonMissingValuemin", "spinbuttonEmptyValuemin", "spinbuttonMissingValuemax", "spinbuttonEmptyValuemax",
      "progressbarMissingValuemin", "progressbarEmptyValuemin", "progressbarMissingValuemax", "progressbarEmptyValuemax",
      "rangeMissingMin", "rangeMissingMax",
    ),
    ...ai("meter-element-error", "meterMissingMinMaxAttributes"),
    ...ai("progress-element-error", "progressMissingMax", "progressEmptyMax"),
  ]],
  ["aria-required-children", "ARIA roles must contain their required children", "Checks that roles such as list, menu or tablist own the child roles they need.", "Add the required child roles (e.g. menuitem inside menu), or change the parent role.", ["1.3.1"], [
    ...ai("menu-element-warning", "menuContainMenuitemElements"),
    ...ibm("aria_child_valid", "list_children_valid"),
    ...axe("aria-required-children"),
  ]],
  ["aria-required-parent", "ARIA roles must be inside their required parent", "Checks that roles such as listitem, tab or option are owned by the right container.", "Wrap the element in the required parent role, e.g. tab inside tablist.", ["1.3.1"], [
    ...ibm("aria_parent_required"),
    ...axe("aria-required-parent"),
  ]],
  ["combobox-pattern", "Comboboxes must follow the ARIA combobox pattern", "Checks combobox focus management, popup references, aria-haspopup and aria-autocomplete.", "Follow the ARIA 1.2 combobox pattern: focus stays on the input, aria-controls points at the popup, aria-activedescendant marks the active option.", ["4.1.2"], [
    ...ibm("combobox_active_descendant", "combobox_autocomplete_valid", "combobox_design_valid", "combobox_focusable_elements", "combobox_haspopup_valid", "combobox_popup_reference"),
  ]],
  ["tabs-structure", "Tab widgets should be fully wired", "Flags tabs without aria-controls and tab lists or panels without a name.", "Point each tab at its panel with aria-controls, and label tablist and tabpanels.", BP, [
    ...ai("tab-element-warning", "tabMissingAriaControls", "tabpanelMissingAccessibleName", "tablistMissingAccessibleName"),
  ]],
  ["live-region", "Live regions should announce updates completely", "Flags aria-live regions without aria-atomic.", "Set aria-atomic to control whether the whole region or only the change is announced.", BP, [
    ...ai("live-region-error", "ariaLiveRegionMissingAria"),
  ]],
  ["aria-braille-equivalent", "Braille labels must have a text equivalent", "Flags aria-braillelabel / aria-brailleroledescription without a regular label / role description.", "Add aria-label or aria-roledescription alongside the braille attribute.", ["4.1.2"], [
    ...axe("aria-braille-equivalent"),
  ]],
  ["aria-roledescription", "Role descriptions need a semantic role", "Flags aria-roledescription on elements without a suitable role.", "Use aria-roledescription only on elements with a meaningful (widget or landmark) role.", ["4.1.2"], [
    ...axe("aria-roledescription"),
  ]],

  // ── Parsing / ids ──
  ["duplicate-id", "Element ids must be unique", "Flags ids used by more than one element.", "Give every element a unique id; update labels and ARIA references accordingly.", ["4.1.1"], [
    ...ai("duplicate-id-error", "duplicateIdAttributeFound"),
    ...ibm("element_id_unique"),
    ...axe("duplicate-id", "duplicate-id-active"),
  ]],
];

/**
 * Source rules that never produce audit results: IBM's internal debug and browser-extension helper
 * rules (not in any IBM ruleset).
 */
export const IGNORED_SOURCES: readonly string[] = ["ibm:debug_paths", "ibm:detector_tabbable"];

/** Rules that report what could not be checked (always impact "info", whatever the source says). */
export const NOTICE_RULES: ReadonlySet<string> = new Set(["frame-unchecked", "hidden-content-unchecked"]);

// ── Merge policies (unify.ts): when two findings describe ONE problem ──

/**
 * Rules about the page as a whole. Engines anchor them on different elements (<html>, <head> or
 * <body>); a finding of these rules on any of the three is the page itself: one finding on <html>.
 */
export const PAGE_RULES: ReadonlySet<string> = new Set([
  "bypass",
  "landmark-one-main",
  "heading-one",
  "document-title",
  "document-title-descriptive",
  "html-has-lang",
  "html-lang-valid",
]);

/**
 * Parent/child double reporting: the same rule flagged on an element AND on one of its descendants.
 *  - "outer": the container is the thing to fix. button-name / link-name (the interactive element
 *    needs the name, not its icon or text child); region (the uncovered block goes into a landmark,
 *    not each of its children); aria-hidden-focus (the aria-hidden container, not each focusable in it).
 *  - "inner": the innermost element is the thing to fix (image-alt: the <img> needs the alt, not the
 *    link or button an engine reports around it).
 * Rules not listed keep both: nested elements are separate issues there (color-contrast: nested text
 * with its own colors; landmark-name / landmark-unique: nested landmarks each need a name;
 * control-name: a menubar and its items; frame-title: a frame inside a frame).
 */
export const NESTED_POLICY: Readonly<Record<string, "outer" | "inner">> = {
  "button-name": "outer",
  "link-name": "outer",
  region: "outer",
  "aria-hidden-focus": "outer",
  "image-alt": "inner",
};

/**
 * A finding of the key rule on a DESCENDANT of an element flagged with one of the listed rules folds
 * into that ancestor's finding: an unlabelled icon inside an unnamed button or link is the same
 * missing name (label the control, then hide the icon; the rule's help says so). When the control
 * has a name, the icon finding stays.
 */
export const NESTED_INTO: Readonly<Record<string, readonly string[]>> = {
  "svg-img-alt": ["button-name", "link-name"],
  "svg-role": ["button-name", "link-name"],
  "role-img-alt": ["button-name", "link-name"],
  "icon-role": ["button-name", "link-name"],
};

/**
 * Same element, two rules, one problem: the key rule's finding folds into the first listed rule
 * found on the same element (its sources are kept). E.g. a field with only a placeholder is reported
 * as "no label" and as "placeholder used as label"; the fix is the same label.
 */
export const SUBSUMED_BY: Readonly<Record<string, readonly string[]>> = {
  "label-visible": ["label"],
};

/** Used for a source rule that is not (yet) mapped, e.g. after an engine upgrade. */
export const FALLBACK_RULE: UnifiedRule = {
  id: "other",
  title: "Other accessibility issue",
  description: "A check without a dedicated rule in this catalog.",
  help: "Inspect the element and compare it with the linked WCAG success criterion.",
  wcag: [],
  tags: ["best-practice"],
  sources: [],
};

function wcagRefs(criteria: string[]): UnifiedWcagRef[] {
  return criteria.map((n) => {
    const c = wcagCriterion(n);
    if (!c) throw new Error(`Unknown WCAG criterion ${n}`);
    return { criterion: c.num, level: c.level, version: c.version };
  });
}

function build(def: Def): UnifiedRule {
  const [id, title, description, help, criteria, sources] = def;
  const wcag = wcagRefs(criteria);
  const tags: UnifiedRuleTag[] = [];
  if (!wcag.length) tags.push("best-practice");
  const in20 = wcag.some((w) => w.version === "2.0" && w.level !== "AAA" && w.criterion !== "4.1.1");
  const in21 = wcag.some((w) => w.version !== "2.2" && w.level !== "AAA");
  if (in20) tags.push("section508");
  if (in21) tags.push("en301549");
  return { id, title, description, help, wcag, tags, sources };
}

/** The unified rule set, in catalog order. */
export const UNIFIED_RULES: readonly UnifiedRule[] = DEFS.map(build);

const BY_ID = new Map<string, UnifiedRule>(UNIFIED_RULES.map((r) => [r.id, r]));
const BY_SOURCE = new Map<string, UnifiedRule>();
for (const r of UNIFIED_RULES) for (const s of r.sources) if (!BY_SOURCE.has(s)) BY_SOURCE.set(s, r);

export function unifiedRule(id: string): UnifiedRule | undefined {
  return id === FALLBACK_RULE.id ? FALLBACK_RULE : BY_ID.get(id);
}

/** Source key, e.g. sourceKey("ibm", "img_alt_valid") -> "ibm:img_alt_valid". */
export function sourceKey(engine: A11yEngineId, rule: string, check?: string): string {
  return engine === "a11yinspect" ? `a11yinspect:${rule}/${check ?? ""}` : `${engine}:${rule}`;
}

/**
 * Source rules whose results mean different problems depending on the check that fired: axe
 * "aria-valid-attr-value" also reports id references that point nowhere (check data "noId"), which
 * is exactly "aria-valid-reference" (where the other engines report it). The axe adapter appends
 * the check's messageKey to `check` ("aria-valid-attr-value:noId").
 */
const CHECK_REFINE: Record<string, Array<[RegExp, string]>> = {
  "axe:aria-valid-attr-value": [[/:(noId|noIdShadow|idrefs)$/, "aria-valid-reference"]],
};

/** Unified rule for a source result (null when the source is unmapped). */
export function unifiedRuleForSource(engine: A11yEngineId, rule: string, check?: string): UnifiedRule | null {
  const key = sourceKey(engine, rule, check);
  for (const [re, id] of CHECK_REFINE[key] ?? []) if (check && re.test(check)) return BY_ID.get(id) ?? null;
  return BY_SOURCE.get(key) ?? null;
}

// Some source rules are broader than one unified rule: e.g. a "form control must have a label" check
// also fires on buttons. Refine by element so the same problem on the same element merges.
const BUTTONISH = 'button,input[type="button" i],input[type="submit" i],input[type="reset" i],[role="button"],summary';
const REFINE: Record<string, (el: Element) => string | null> = {
  label: (el) =>
    safeMatches(el, BUTTONISH) ? "button-name" : safeMatches(el, "[role]") && !safeMatches(el, "input,select,textarea") ? "control-name" : null,
  "control-name": (el) => (safeMatches(el, BUTTONISH) ? "button-name" : safeMatches(el, 'a[href],[role="link"]') ? "link-name" : null),
  // "A list role must own listitems" on a native ul/ol is the list-structure problem.
  "aria-required-children": (el) => (safeMatches(el, "ul,ol") && !safeMatches(el, "[role]") ? "list" : null),
  // "Scripting emulates a link" on an element that is not a link is a mouse-only interaction.
  "link-href": (el) => (el.localName && !safeMatches(el, 'a,area,[role="link"]') ? "keyboard-access" : null),
};

function safeMatches(el: Element, sel: string): boolean {
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
}

/** Element-aware refinement of a unified rule (see REFINE); returns the rule unchanged when not applicable. */
export function refineRule(rule: UnifiedRule, el: Element | null): UnifiedRule {
  const f = el ? REFINE[rule.id] : undefined;
  const id = f && el ? f(el) : null;
  return (id && BY_ID.get(id)) || rule;
}

/** Whether a unified rule is part of a standard (WCAG criteria in scope, or a best practice if enabled). */
export function ruleInStandard(rule: UnifiedRule, s: A11yStandard): boolean {
  const inScope = rule.wcag.some((w) => criterionInStandard(w.criterion, s));
  if (inScope) return true;
  // Best practices, and rules whose only criteria are obsolete in this version (4.1.1 in WCAG 2.2).
  const obsoleteOnly = rule.wcag.length > 0 && rule.wcag.every((w) => wcagCriterion(w.criterion)?.obsoleteIn && s.version === "2.2");
  return s.bestPractices && (rule.wcag.length === 0 || obsoleteOnly);
}

/** Criteria referenced by the catalog (sanity check helper for tests). */
export function catalogCriteria(): string[] {
  const set = new Set<string>();
  for (const r of UNIFIED_RULES) for (const w of r.wcag) set.add(w.criterion);
  return WCAG_CRITERIA.filter((c) => set.has(c.num)).map((c) => c.num);
}
