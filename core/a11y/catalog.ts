// GENERATED from BarrierBreak eslint-plugin-a11yinspect v1.0.13 rule messages (MIT, see THIRD_PARTY_NOTICES.md).
// Message text is the source text with the leading emoji stripped; the help sentences are ours.
// ruleId -> messageId -> [message, help]
export const CATALOG: Record<string, Record<string, readonly [string, string]>> = {
  "a-element-error": {
    linkAccessibleName: ["[Critical] Link has no accessible name (2.4.4 A)", "Give the link text content, an aria-label, or an image with meaningful alt text inside it."],
    linkTextOnlyUrl: ["[Best Practice] Link text is only a URL (2.4.4 A)", "Replace the raw URL with text that describes the link destination."],
    linkMissingHrefAttribute: ["[Blocker] Link missing href attribute (2.1.1 A)", "Add an href so the link is keyboard reachable, or use a <button> for actions."],
    linkHrefEmpty: ["[Best Practice] Link href is empty or # (2.1.1 A)", "Point href at a real destination, or use a <button> if the element triggers an action."],
    linkImgMissingAlt: ["[Critical] img inside link missing alt attribute (1.1.1 A)", "Add alt text to the image that describes the link destination (alt=\"\" only if the link has other text)."],
    linkSvgMissingAccessibleName: ["[Major] SVG inside link missing accessible name (aria-label, aria-labelledby, or title child) (1.1.1 A)", "Give the SVG a <title>, aria-label or aria-labelledby, or mark it aria-hidden=\"true\" if the link has text."],
    roleLinkMissingTabindex: ["[Major] Element with role=\"link\" missing tabindex attribute (2.1.1 A)", "Add tabindex=\"0\" (and Enter key handling), or better, use a real <a href> element."],
  },
  "a-element-warning": {
    linkTextGenericClickHere: ["[Critical] Link text is generic (click here, read more, etc) (2.4.4 A)", "Use link text that describes the destination on its own, e.g. \"Download the 2024 report\"."],
    linkTextTooLong: ["[Best Practice] Link accessible name exceeds 150 characters (2.4.4 A)", "Shorten the link's accessible name to a concise description of its destination."],
    linkTabindexNegative: ["[Major] Link has tabindex=-1 making it unreachable by keyboard navigation (2.1.1 A)", "Remove tabindex=\"-1\" so keyboard users can reach the link, or hide the link from everyone."],
  },
  "abbr-element-error": {
    abbrElementMissingTitleAttribute: ["[Minor] abbr element missing title attribute (3.1.4 AAA)", "Add a title with the expansion, or spell the term out on first use."],
  },
  "accesskey-element-error": {
    duplicateAccesskey: ["[Best Practice] Duplicate accesskey value found (2.1.1 A)", "Give every accesskey a unique value (or remove accesskey entirely)."],
  },
  "area-element-error": {
    areaMissingAltAttribute: ["[Critical] area missing alt attribute (2.4.4 A)", "Add alt text to each <area> describing its link destination."],
    areaEmptyAlt: ["[Critical] area has empty alt (2.4.4 A)", "Fill in the <area> alt text so the hotspot has a name."],
    areaMissingHrefAttribute: ["[Blocker] area missing href attribute (2.1.1 A)", "Add an href to the <area>, or remove it if it is not a link."],
  },
  "aria-element-error": {
    emptyAriaLabelAttribute: ["[Major] Empty aria-label attribute (4.1.2 A)", "Put meaningful text in aria-label, or remove the empty attribute."],
    invalidAriaRole: ["[Major] Invalid ARIA role (4.1.2 A)", "Use a valid WAI-ARIA role name, or remove the role attribute."],
    ariaInvalidProp: ["[Major] Invalid ARIA attribute (unknown aria-* property) (4.1.2 A)", "Fix the spelling of the aria-* attribute or remove it; unknown ARIA attributes are ignored."],
  },
  "aria-element-warning": {
    ariaHiddenFocusableElement: ["[Critical] aria-hidden on focusable element (4.1.2 A)", "Remove aria-hidden from the focusable element (and its ancestors), or take it out of the tab order with tabindex=\"-1\" or inert."],
    ariaRoleRedundant: ["[Best Practice] Element has ARIA role that matches its implicit default role (4.1.2 A)", "Remove the role attribute; the element already has that role natively."],
    ariaInvalidPropValue: ["[Major] Invalid value for ARIA attribute (4.1.2 A)", "Use one of the values the ARIA specification allows for this attribute."],
    preferSemanticElement: ["[Best Practice] Prefer semantic HTML element over ARIA role (4.1.2 A)", "Replace the div/span + role with the equivalent native HTML element."],
    noninteractiveElementInteractiveRole: ["[Critical] Non-interactive element should not have interactive ARIA role (4.1.2 A)", "Use a native interactive element (e.g. <button>) instead of adding an interactive role to this element."],
    interactiveElementNoninteractiveRole: ["[Critical] Interactive element should not have non-interactive ARIA role (4.1.2 A)", "Do not override an interactive element with a non-interactive role; wrap it or use a different element."],
  },
  "autocomplete-element-error": {
    invalidAutocompleteValue: ["[Major] Invalid autocomplete value (1.3.5 AA)", "Use a valid HTML autocomplete token (e.g. email, given-name, street-address)."],
  },
  "autocomplete-element-warning": {
    inputHaveAutocompleteAttribute: ["[Major] Input should have autocomplete attribute (1.3.5 AA)", "Add an autocomplete attribute that identifies the purpose of this personal-data field."],
  },
  "autofocus-element-warning": {
    noAutofocus: ["[Critical] Avoid using autoFocus - it can disorient screen reader users (2.4.3 A)", "Remove autofocus and let users start at the top of the page, or move focus only after an explicit user action."],
  },
  "blockquote-element-warning": {
    blockquoteHaveCiteAttributeAttribution: ["[Best Practice] blockquote should have cite attribute for attribution (1.3.1 A)", "Add a cite attribute (or a visible <cite>) that identifies the quote's source."],
  },
  "button-element-error": {
    buttonAccessibleName: ["[Critical] Button has no accessible name (4.1.2 A)", "Give the button visible text, an aria-label, or a labelled icon."],
    buttonSvgMissingRoleImg: ["[Best Practice] SVG inside button missing role=\"img\" attribute (4.1.2 A)", "Add role=\"img\" and a name to the SVG, or aria-hidden=\"true\" if it is decorative."],
    buttonSvgHiddenFromAT: ["[Major] SVG inside button with role=\"presentation\"/\"none\" or aria-hidden=true hides content from assistive technology (4.1.2 A)", "Remove aria-hidden/role=\"none\" from the labelled SVG, or drop its label if it is purely decorative."],
    buttonSvgMissingLabel: ["[Major] SVG inside button with role=\"img\" missing accessible name (aria-label or aria-labelledby) (1.1.1 A)", "Give the role=\"img\" SVG an aria-label, aria-labelledby or <title>."],
    buttonImgMissingAlt: ["[Critical] img inside button missing alt attribute (1.1.1 A)", "Add alt text to the image (alt=\"\" if the button already has text)."],
    buttonImgEmptyAlt: ["[Major] img inside button has empty or whitespace-only alt attribute (1.1.1 A)", "Use alt=\"\" (no spaces) for decorative images, or write meaningful alt text."],
    buttonIconHiddenFromAT: ["[Major] Icon element inside button with role=\"presentation\"/\"none\" or aria-hidden=true hides content from assistive technology (4.1.2 A)", "Remove aria-hidden/role=\"none\" from the labelled icon, or drop its label if it is purely decorative."],
    buttonIconMissingRole: ["[Major] Icon element inside button missing role=\"img\" attribute (4.1.2 A)", "Add role=\"img\" and an aria-label to the icon, or aria-hidden=\"true\" if it is decorative."],
    buttonIconMissingLabel: ["[Major] Icon element inside button with role=\"img\" missing accessible name (aria-label or aria-labelledby) (4.1.2 A)", "Give the role=\"img\" icon an aria-label or aria-labelledby."],
    buttonImgSvgIconGenericLabel: ["[Minor] Image, SVG or icon inside button has a generic accessible name (1.1.1 A)", "Describe what the button does (\"Close\", \"Search\") instead of what the graphic is."],
  },
  "button-element-warning": {
    buttonTextGeneric: ["[Major] Button text is generic (2.4.6 AA)", "Use button text that says what happens, e.g. \"Save changes\" instead of \"OK\"."],
  },
  "canvas-element-error": {
    canvasMissingRoleImg: ["[Blocker] Canvas element missing role=\"img\" attribute (4.1.2 A)", "Add role=\"img\" with an aria-label, or put fallback text content inside the <canvas>."],
  },
  "canvas-element-warning": {
    canvasDecorative: ["[Minor] Canvas marked as decorative - verify if informative or decorative (1.1.1 A)", "Confirm the canvas is purely decorative; if it conveys information, give it role=\"img\" and a name."],
    canvasMissingDescription: ["[Blocker] Canvas with role=\"img\" missing accessible description (no aria-label, aria-labelledby, or text content) (1.1.1 A)", "Add an aria-label/aria-labelledby or fallback text describing the canvas content."],
    canvasHasDescription: ["[Major] Canvas element has accessible description - verify it is accurate (1.1.1 A)", "Check that the canvas's label or fallback text still matches what it draws."],
  },
  "checked-element-error": {
    checkboxRadioMissingNameAttribute: ["[Best Practice] Checkbox/radio missing name attribute (1.3.1 A)", "Add a name attribute so the checkbox/radio groups and submits correctly."],
  },
  "checked-element-warning": {
    ariaCheckedTrueFalseMixed: ["[Major] aria-checked should be true, false, or mixed (4.1.2 A)", "Set aria-checked to \"true\", \"false\" or \"mixed\"."],
  },
  "click-handler-warning": {
    onclickWithoutOnkeydownOnkeyup: ["[Critical] onClick without onKeyDown/onKeyUp (2.1.1 A)", "Use a <button>, or add role, tabindex=\"0\" and Enter/Space key handling alongside the click handler."],
    mouseEventWithoutKeyboardEquivalent: ["[Critical] Mouse event without keyboard equivalent (2.1.1 A)", "Pair mouseover/mouseout handlers with focus/blur handlers so keyboard users get the same behaviour."],
  },
  "description-element-error": {
    ariaDescriptionEmpty: ["[Minor] aria-description is empty (4.1.2 A)", "Put meaningful text in aria-description, or remove the attribute."],
  },
  "description-element-warning": {
    elementAriaDescribedbyReferencesNon: ["[Major] Element with aria-describedby references non-existent id (4.1.2 A)", "Make aria-describedby reference ids of elements that exist in the document."],
  },
  "details-element-error": {
    detailsElementMissingSummaryChild: ["[Major] details element missing summary child (1.3.1 A)", "Add a <summary> as the first child of <details>."],
    summaryElementInsideDetails: ["[Major] summary element not inside details (1.3.1 A)", "Only use <summary> as a direct child of <details>."],
  },
  "details-element-warning": {
    detailsAriaHidden: ["[Major] details element with aria-hidden=true hides its content from assistive technology (4.1.2 A)", "Remove aria-hidden from the <details> element so its content is available to assistive technology."],
  },
  "dialog-element-error": {
    dialogMissingAccessibleName: ["[Major] Dialog missing accessible name (4.1.2 A)", "Name the dialog with aria-labelledby pointing at its heading, or with aria-label."],
  },
  "dialog-element-warning": {
    modalDialogTrapFocus: ["[Major] Modal dialog should trap focus (2.4.3 A)", "Move focus into the modal dialog when it opens and keep Tab cycling inside it (or use <dialog>.showModal())."],
    dialogAriaHidden: ["[Major] dialog/alertdialog element with aria-hidden=true is hidden from assistive technology (4.1.2 A)", "Remove aria-hidden from the open dialog, or hide the dialog completely when it is closed."],
  },
  "disabled-element-warning": {
    disabledElementTabOrder: ["[Minor] Disabled element should not be in tab order (2.4.3 A)", "Remove tabindex from disabled elements (or use aria-disabled if it must stay focusable)."],
    ariaDisabledTrueFalse: ["[Major] aria-disabled should be true or false (4.1.2 A)", "Set aria-disabled to \"true\" or \"false\"."],
  },
  "distracting-element-error": {
    noMarquee: ["[Critical] Do not use <marquee> - it cannot be paused and violates WCAG 2.2.2 (2.2.2 A)", "Replace <marquee> with static content, or an animation the user can pause."],
    noBlink: ["[Critical] Do not use <blink> - it cannot be paused and violates WCAG 2.2.2 (2.2.2 A)", "Remove <blink>; use a non-flashing way to draw attention."],
  },
  "dl-element-error": {
    dlContainsInvalidChildren: ["[Minor] dl contains invalid children (1.3.1 A)", "Only put <dt>, <dd> (optionally wrapped in <div>), <script> or <template> inside <dl>."],
    dtDdInsideDl: ["[Minor] dt/dd not inside dl (1.3.1 A)", "Wrap <dt>/<dd> in a <dl> element."],
    dtNotFirstChildOfDl: ["[Minor] dt element is not the first child element of dl (1.3.1 A)", "Start the <dl> (or each <div> group) with a <dt> term."],
    dlMissingDdElement: ["[Minor] dl element has dt but is missing dd (definition) children (1.3.1 A)", "Add a <dd> definition for each <dt> term."],
    dlEmptyTerm: ["[Minor] dl contains empty dt or dd element (1.3.1 A)", "Give every <dt> and <dd> content, or remove the empty element."],
  },
  "duplicate-id-error": {
    duplicateIdAttributeFound: ["[Minor] Duplicate id attribute found (4.1.1 A)", "Make every id unique in the document so label, ARIA and fragment references resolve correctly."],
  },
  "embed-element-error": {
    embedMissingAccessibleName: ["[Major] embed missing accessible name (4.1.2 A)", "Give the <embed> an aria-label, aria-labelledby or title describing its content."],
    embedMissingTypeAttribute: ["[Best Practice] embed missing type attribute (4.1.2 A)", "Add a type attribute with the embedded resource's MIME type."],
  },
  "expanded-element-warning": {
    ariaExpandedTrueFalse: ["[Major] aria-expanded should be true or false (4.1.2 A)", "Set aria-expanded to \"true\" or \"false\"."],
    ariaControlsReferencesNonExistent: ["[Major] aria-controls references non-existent id (4.1.2 A)", "Make aria-controls reference the id of an element that exists in the document."],
  },
  "figure-element-error": {
    figureMissingFigcaption: ["[Minor] figure missing figcaption (1.1.1 A)", "Add a <figcaption>, or label the figure with aria-label/aria-labelledby."],
  },
  "focus-element-error": {
    activedescendantNotFocusable: ["[Blocker] Element with aria-activedescendant must be focusable (add tabIndex) (2.1.1 A)", "Add tabindex=\"0\" to the element that owns aria-activedescendant so it can receive focus."],
    unnecessaryTabindex: ["[Major] Redundant tabindex=0 on natively focusable element — remove it (2.4.3 A)", "Remove tabindex=\"0\"; the element is already focusable."],
  },
  "focus-element-warning": {
    positiveTabindexValueFound: ["[Major] Positive tabindex value found (2.4.3 A)", "Use tabindex=\"0\" or \"-1\" and fix the tab order by reordering the DOM."],
    elementTabindexButRole: ["[Major] Element has tabindex but no role (4.1.2 A)", "Give the focusable element a role (or use a native interactive element) so its purpose is announced."],
    interactiveRoleNotFocusable: ["[Blocker] Element with interactive role must be focusable (add tabIndex) (2.1.1 A)", "Add tabindex=\"0\" (or \"-1\" when focus is managed by a composite widget) to the element with an interactive role."],
  },
  "form-element-error": {
    formMissingAccessibleName: ["[Minor] Form missing accessible name (1.3.1 A)", "Name the form with aria-label or aria-labelledby (e.g. pointing at its heading)."],
    fieldsetMissingLegend: ["[Minor] Fieldset missing legend (1.3.1 A)", "Add a <legend> as the first child of the <fieldset> describing the group."],
  },
  "form-element-warning": {
    formHaveSubmitButton: ["[Best Practice] Form should have submit button (3.2.2 A)", "Add a submit button (<button type=\"submit\"> or <input type=\"submit\">) to the form."],
  },
  "heading-element-error": {
    headingEmpty: ["[Minor] Heading is empty (1.3.1 A)", "Put text in the heading, or remove the empty heading element."],
    headingLevelSkipped: ["[Major] Heading level skipped (1.3.1 A)", "Use the next heading level down (e.g. h2 then h3) instead of skipping levels."],
    headingNested: ["[Major] Heading contains nested heading element (1.3.1 A)", "Do not put a heading inside another heading; use a single heading element."],
  },
  "heading-element-warning": {
    multipleH1: ["[Best Practice] Multiple h1 elements on page (1.3.1 A)", "Use one <h1> for the page title and h2-h6 for sections."],
    headingOnlyImageNoAlt: ["[Minor] Heading contains only image without alt (1.3.1 A)", "Give the heading image alt text that works as the heading, or add heading text."],
    headingHiddenOrPresentation: ["[Minor] Heading has role=presentation/none or aria-hidden=true (1.3.1 A)", "Remove aria-hidden/role=\"none\" from the heading, or use a non-heading element if it is not a heading."],
    headingRoleMissingAriaLevel: ["[Minor] Element with role=\"heading\" missing aria-level attribute (1.3.1 A)", "Add aria-level (1-6) to the role=\"heading\" element, or use an <h1>-<h6>."],
  },
  "hr-element-warning": {
    hrHaveRoleSeparatorPresentation: ["[Best Practice] hr should have role separator or presentation (1.3.1 A)", "Use role=\"separator\" or role=\"none\" on <hr>, or remove the role."],
  },
  "iframe-element-error": {
    iframeMissingTitle: ["[Minor] iframe missing title attribute (4.1.2 A)", "Add a title attribute describing the iframe's content."],
    iframeEmptyTitle: ["[Minor] iframe has empty title attribute (4.1.2 A)", "Fill in the iframe title with a description of its content."],
  },
  "iframe-element-warning": {
    iframeHidden: ["[Major] iframe is hidden (role=presentation/none or aria-hidden=true) (4.1.2 A)", "Confirm the iframe has no meaningful or focusable content; otherwise remove aria-hidden/role=\"none\"."],
  },
  "img-element-error": {
    imgMissingAlt: ["[Critical] img missing alt attribute (1.1.1 A)", "Add an alt attribute (aria-label alone is not a substitute on <img>)."],
    imgEmptyAlt: ["[Critical] img has empty alt (1.1.1 A)", "Write alt text that describes the image; use alt=\"\" without spaces only for decorative images that are not the sole content of a control."],
    imgMissingAltNoAria: ["[Critical] img missing alt attribute and has no aria-label or aria-labelledby (1.1.1 A)", "Add alt text describing the image, or alt=\"\" if it is decorative."],
    imgRoleImgAriaHidden: ["[Major] img with role=\"img\" has aria-hidden=true — use role=\"presentation\" or role=\"none\" instead (1.1.1 A)", "Remove aria-hidden and give the image a name, or use role=\"presentation\" for a decorative image."],
    iconMissingAccessibleName: ["[Major] Icon element (<i>) with role=\"img\" missing accessible name (aria-label or aria-labelledby) (1.1.1 A)", "Give the role=\"img\" icon an aria-label or aria-labelledby."],
  },
  "img-element-warning": {
    imgAltFilename: ["[Minor] img alt contains filename (1.1.1 A)", "Replace the file name in alt with a description of the image."],
    imgDecorative: ["[Minor] img marked as decorative (role=presentation/none or aria-hidden=true) - verify if informative or decorative (1.1.1 A)", "Confirm the image is purely decorative; if it conveys information, give it alt text."],
    imgAltGeneric: ["[Minor] img alt text is generic (image, graphic, picture, photo, spacer, etc.) (1.1.1 A)", "Describe what the image shows instead of generic words like \"image\" or \"photo\"."],
    imgMissingSrc: ["[Major] img element missing src attribute (1.1.1 A)", "Add a src attribute (or srcset) to the image."],
    iconMissingRoleImg: ["[Minor] Icon element (<i>) missing role=\"img\" attribute (1.1.1 A)", "Add role=\"img\" and an aria-label to the icon, or aria-hidden=\"true\" if it is decorative."],
  },
  "input-element-error": {
    inputMissingAssociatedLabel: ["[Major] Input missing associated label (1.3.1 A)", "Associate a <label for> with the input, wrap it in a <label>, or add aria-label/aria-labelledby."],
    inputMissingTypeAttribute: ["[Best Practice] Input missing type attribute (1.3.1 A)", "Add an explicit type attribute to the input."],
    inputTypeImageMissingAlt: ["[Critical] Input[type=image] missing alt attribute (1.1.1 A)", "Add alt text to the image button describing its action."],
    inputMissingNameAttribute: ["[Best Practice] Input missing name attribute (1.3.1 A)", "Add a name attribute so the field submits and autofills correctly."],
  },
  "input-element-warning": {
    inputPlaceholderLabelSubstitute: ["[Major] Input placeholder is not a label substitute (1.3.1 A)", "Add a persistent visible <label>; placeholder text disappears while typing and is not a reliable label."],
  },
  "label-element-error": {
    labelMissingAttribute: ["[Major] Label missing for attribute (1.3.1 A)", "Add a for attribute pointing at an existing control id, or nest the control inside the <label>."],
    labelTextContent: ["[Critical] Label has no text content (4.1.2 A)", "Put visible text in the <label> describing the control."],
  },
  "label-element-warning": {},
  "landmark-element-error": {
    pageHaveMainLandmark: ["[Major] Page should have main landmark (1.3.1 A)", "Wrap the page's primary content in a <main> element."],
  },
  "landmark-element-warning": {
    landmarkMissingAccessibleName: ["[Minor] Landmark missing accessible name (1.3.1 A)", "Give repeated or region landmarks a unique aria-label or aria-labelledby."],
    multipleMainLandmarksFound: ["[Best Practice] Multiple main landmarks found (1.3.1 A)", "Keep a single visible <main> landmark per page."],
    landmarkAriaHidden: ["[Major] Landmark element with aria-hidden=true is hidden from assistive technology (1.3.1 A)", "Remove aria-hidden from the landmark so its content stays available to assistive technology."],
  },
  "lang-element-error": {
    htmlElementMissingLangAttribute: ["[Major] html element missing lang attribute (3.1.1 A)", "Add a lang attribute to <html>, e.g. lang=\"en\"."],
    invalidLangAttributeValue: ["[Major] Invalid lang attribute value (3.1.1 A)", "Use a valid BCP 47 language tag, e.g. \"en\" or \"pt-BR\"."],
    emptyLangAttribute: ["[Major] Empty lang attribute (3.1.1 A)", "Set lang on <html> to the page's language code."],
  },
  "list-element-error": {
    liOrphan: ["[Major] li element not inside ul/ol/menu (1.3.1 A)", "Put <li> elements inside a <ul>, <ol> or <menu>."],
    listNoItems: ["[Major] List (ul/ol or role=list) has no li or listitem children (1.3.1 A)", "Add <li> (or role=\"listitem\") children, or remove the empty list."],
    listEmptyItem: ["[Minor] List contains empty li elements (1.3.1 A)", "Give every list item content, or remove the empty <li>."],
    liNestedInLi: ["[Major] li element incorrectly nested inside another li (1.3.1 A)", "Nest sub-items in a <ul>/<ol> inside the parent <li>, not directly in the <li>."],
  },
  "list-element-warning": {
    listInvalidChildren: ["[Minor] ul/ol contains non-li children (1.3.1 A)", "Only put <li>, <script> or <template> directly inside <ul>/<ol>."],
    listInvalidElement: ["[Minor] Non-li element with text content nested directly in ul/ol (1.3.1 A)", "Wrap this content in an <li>."],
    listRedundantRoleList: ["[Best Practice] ul/ol element has redundant role=\"list\" (implicit default) (1.3.1 A)", "Remove role=\"list\" unless it restores list semantics removed by list-style: none."],
    listitemRedundantRole: ["[Best Practice] li element has redundant role=\"listitem\" (implicit default) (1.3.1 A)", "Remove role=\"listitem\" from the <li>."],
    listAriaHidden: ["[Major] List element or list item with aria-hidden=true is hidden from assistive technology (1.3.1 A)", "Remove aria-hidden from the list so its items stay available to assistive technology."],
  },
  "live-region-error": {
    ariaLiveRegionMissingAria: ["[Major] aria-live region missing aria-atomic (4.1.2 A)", "Add aria-atomic (true to announce the whole region, false for changed nodes only)."],
    invalidAriaLiveValue: ["[Major] Invalid aria-live value (4.1.2 A)", "Set aria-live to \"off\", \"polite\" or \"assertive\"."],
  },
  "map-element-error": {
    mapMissingNameAttribute: ["[Best Practice] map missing name attribute (1.1.1 A)", "Add a name to the <map> and reference it from the image's usemap."],
    mapAreaChildren: ["[Best Practice] map has no area children (1.1.1 A)", "Add <area> elements to the <map>, or remove the unused map."],
    mapEmptyNameAttribute: ["[Minor] map name attribute is empty (1.1.1 A)", "Give the <map> a non-empty name matching the image's usemap."],
  },
  "map-element-warning": {
    mapAriaHidden: ["[Major] map element with aria-hidden=true is hidden from assistive technology (1.1.1 A)", "Remove aria-hidden from the <map> so its links stay available."],
  },
  "media-element-error": {
    videoElementMissingCaptions: ["[Critical] video element missing captions (1.2.2 A)", "Add a <track kind=\"captions\"> with synchronized captions."],
    audioElementMissingTranscript: ["[Major] audio element missing transcript (1.2.1 A)", "Provide a text transcript next to the audio (and reference it with aria-describedby)."],
    videoElementMissingAudioDescription: ["[Major] video element missing audio description (1.2.5 AA)", "Add a <track kind=\"descriptions\"> or an audio-described version of the video."],
  },
  "media-element-warning": {
    mediaElementAutoplay: ["[Critical] media element has autoplay (1.4.2 A)", "Do not autoplay media with sound; start muted or let the user press play."],
    mediaRoleWithControls: ["[Major] audio/video with controls attribute should not have a role attribute (4.1.2 A)", "Remove the role attribute so the native media controls keep their semantics."],
    audioAriaHidden: ["[Major] audio element with aria-hidden=true is hidden from assistive technology (1.1.1 A)", "Remove aria-hidden from the audio element so its controls are available."],
    videoAriaHidden: ["[Major] video element with aria-hidden=true or tabindex=-1 is inaccessible (1.1.1 A)", "Remove aria-hidden / tabindex=\"-1\" so the video and its controls are reachable."],
    videoCaptionsWithoutDescriptions: ["[Major] video has a captions track but no descriptions track — check that a transcript or audio description is provided (1.2.3 A)", "Add a descriptions track or link a transcript / audio-described version."],
  },
  "menu-element-error": {
    menuItemRadioMissingAccessibleName: ["[Major] menuitemradio missing accessible name (aria-label or aria-labelledby) (4.1.2 A)", "Give the menuitemradio text content or an aria-label."],
    menuItemCheckboxMissingAccessibleName: ["[Major] menuitemcheckbox missing accessible name (aria-label or aria-labelledby) (4.1.2 A)", "Give the menuitemcheckbox text content or an aria-label."],
    menuItemRadioMissingAriaChecked: ["[Major] menuitemradio missing aria-checked attribute (4.1.2 A)", "Add aria-checked=\"true\"/\"false\" to the menuitemradio."],
    menuItemCheckboxMissingAriaChecked: ["[Major] menuitemcheckbox missing aria-checked attribute (4.1.2 A)", "Add aria-checked=\"true\"/\"false\" to the menuitemcheckbox."],
    menubarMissingAccessibleName: ["[Major] menubar missing accessible name (aria-label or aria-labelledby) (4.1.2 A)", "Name the menubar with aria-label or aria-labelledby."],
  },
  "menu-element-warning": {
    menuContainMenuitemElements: ["[Minor] menu should contain menuitem elements (1.3.1 A)", "Give the role=\"menu\" element menuitem, menuitemcheckbox or menuitemradio children."],
    menuMissingAccessibleName: ["[Minor] menu missing accessible name (4.1.2 A)", "Name the menu with aria-label or aria-labelledby (e.g. its trigger button)."],
  },
  "meta-element-error": {
    metaViewportDisablesZoom: ["[Minor] meta viewport disables zoom (1.4.4 AA)", "Remove user-scalable=no and maximum-scale limits from the viewport meta tag."],
    viewportUserScalableNo: ["[Major] Viewport meta tag has user-scalable=no or user-scalable=0 (1.4.4 AA)", "Remove user-scalable=no/0 from the viewport meta tag so users can zoom."],
    viewportMaxScaleLow: ["[Major] Viewport meta tag has maximum-scale less than 2 (1.4.4 AA)", "Remove maximum-scale or set it to at least 2 (preferably 5)."],
  },
  "meta-element-warning": {
    metaRefreshTimeout: ["[Critical] meta refresh with timeout found (2.2.1 A)", "Remove the timed meta refresh; let users refresh or navigate themselves."],
    metaRefreshDetected: ["[Critical] Meta http-equiv=\"refresh\" detected (2.2.4 AAA)", "Replace meta refresh with a server-side redirect or a user-initiated update."],
  },
  "meter-element-error": {
    meterMissingAccessibleName: ["[Critical] meter missing accessible name (4.1.2 A)", "Label the <meter> with a <label>, aria-label or aria-labelledby."],
    meterMissingMinMaxAttributes: ["[Best Practice] meter missing min/max attributes (4.1.2 A)", "Add explicit min and max attributes to the <meter>."],
  },
  "object-element-error": {
    objectMissingFallbackContent: ["[Best Practice] object missing fallback content (1.1.1 A)", "Put fallback text inside <object> or give it an aria-label."],
    objectMissingTypeAttribute: ["[Best Practice] object missing type attribute (1.1.1 A)", "Add a type attribute with the object's MIME type."],
  },
  "object-element-warning": {
    objectAriaHidden: ["[Major] object element with aria-hidden=true is hidden from assistive technology (1.1.1 A)", "Remove aria-hidden from the <object> if it contains meaningful content."],
  },
  "optgroup-element-error": {
    optgroupMissingLabelAttribute: ["[Best Practice] optgroup missing label attribute (1.3.1 A)", "Add a label attribute naming the option group."],
    optgroupEmptyLabel: ["[Best Practice] optgroup has empty label (1.3.1 A)", "Fill in the optgroup label."],
  },
  "orientation-element-error": {
    invalidAriaOrientationValue: ["[Major] Invalid aria-orientation value (4.1.2 A)", "Set aria-orientation to \"horizontal\" or \"vertical\"."],
  },
  "output-element-error": {
    outputMissingAccessibleName: ["[Best Practice] output missing accessible name (4.1.2 A)", "Label the <output> with a <label for>, aria-label or aria-labelledby."],
  },
  "pressed-element-warning": {
    ariaPressedTrueFalseMixed: ["[Major] aria-pressed should be true, false, or mixed (4.1.2 A)", "Set aria-pressed to \"true\", \"false\" or \"mixed\"."],
  },
  "progress-element-error": {
    progressMissingAccessibleName: ["[Critical] progress missing accessible name (4.1.2 A)", "Label the <progress> with a <label>, aria-label or aria-labelledby."],
    progressMissingMax: ["[Best Practice] progress element missing max attribute (4.1.2 A)", "Add a max attribute to the <progress> element."],
    progressEmptyMax: ["[Best Practice] progress element has empty max attribute (4.1.2 A)", "Give the progress max attribute a numeric value."],
  },
  "required-element-warning": {
    requiredFieldHaveVisualIndicator: ["[Major] Required field should have visual indicator (3.3.2 A)", "Show that the field is required in its visible label (e.g. \"(required)\" or an explained asterisk)."],
  },
  "role-props-element-error": {
    roleMissingRequiredProp: ["[Major] Role requires aria property that is missing (4.1.2 A)", "Add the ARIA state/property this role requires (see detail)."],
  },
  "role-props-element-warning": {
    roleUnsupportedProp: ["[Major] ARIA property is not supported by this role (4.1.2 A)", "Remove the aria-* attribute this role does not support (see detail), or change the role."],
  },
  "ruby-element-error": {
    rubyMissingRtElement: ["[Minor] ruby missing rt element (3.1.2 AA)", "Add an <rt> element with the pronunciation annotation."],
  },
  "ruby-element-warning": {
    rubyHaveRpFallback: ["[Minor] ruby should have rp for fallback (4.1.2 A)", "Wrap the <rt> text in <rp> parentheses for browsers without ruby support."],
  },
  "scope-element-error": {
    thMissingScopeAttribute: ["[Minor] th missing scope attribute (1.3.1 A)", "Add scope=\"col\" or scope=\"row\" to the header cell."],
    invalidScopeValue: ["[Minor] Invalid scope value (1.3.1 A)", "Use scope=\"row\", \"col\", \"rowgroup\" or \"colgroup\"."],
  },
  "section-element-warning": {
    sectionHaveHeading: ["[Major] section should have heading (1.3.1 A)", "Start the <section> with a heading describing its content."],
    sectionHaveAccessibleName: ["[Major] section should have accessible name (1.3.1 A)", "Name the <section> with aria-labelledby pointing at its heading."],
  },
  "select-element-error": {
    selectMissingAssociatedLabel: ["[Major] Select missing associated label (4.1.2 A)", "Associate a <label for> with the select, or add aria-label/aria-labelledby."],
    selectMissingNameAttribute: ["[Best Practice] Select missing name attribute (4.1.2 A)", "Add a name attribute to the select."],
    selectOptions: ["[Best Practice] Select has no options (4.1.2 A)", "Add <option> elements to the select."],
  },
  "selected-element-warning": {
    ariaSelectedTrueFalse: ["[Major] aria-selected should be true or false (4.1.2 A)", "Set aria-selected to \"true\" or \"false\"."],
    optionElementHaveValueAttribute: ["[Best Practice] option element should have value attribute (4.1.2 A)", "Add an explicit value attribute to the <option>."],
  },
  "skip-link-warning": {
    pageHaveSkipLink: ["[Best Practice] Page should have skip link (2.4.1 A)", "Add a \"Skip to main content\" link as the first focusable element, pointing at the main content's id."],
  },
  "slider-element-warning": {
    sliderMissingName: ["[Critical] Element with role=\"slider\" missing accessible name (no aria-label or aria-labelledby) (4.1.2 A)", "Label the slider with aria-label, aria-labelledby or a <label>."],
    sliderEmptyAriaLabel: ["[Critical] Element with role=\"slider\" has empty aria-label (4.1.2 A)", "Put meaningful text in the slider's aria-label."],
    sliderMissingTabindex: ["[Blocker] Element with role=\"slider\" missing tabindex=\"0\" for keyboard access (2.1.1 A)", "Add tabindex=\"0\" so the custom slider can be reached with the keyboard."],
    sliderHasName: ["[Major] Element with role=\"slider\" has accessible name (2.4.6 AA)", "Check that the slider's name describes the value it controls."],
    sliderMissingValuemin: ["[Best Practice] Element with role=\"slider\" missing aria-valuemin attribute (4.1.2 A)", "Add aria-valuemin to the slider."],
    sliderEmptyValuemin: ["[Best Practice] Element with role=\"slider\" has empty aria-valuemin attribute (4.1.2 A)", "Give the slider's aria-valuemin a numeric value."],
    sliderMissingValuemax: ["[Best Practice] Element with role=\"slider\" missing aria-valuemax attribute (4.1.2 A)", "Add aria-valuemax to the slider."],
    sliderEmptyValuemax: ["[Best Practice] Element with role=\"slider\" has empty aria-valuemax attribute (4.1.2 A)", "Give the slider's aria-valuemax a numeric value."],
    scrollbarMissingValuemin: ["[Best Practice] Element with role=\"scrollbar\" missing aria-valuemin attribute (4.1.2 A)", "Add aria-valuemin to the scrollbar."],
    scrollbarEmptyValuemin: ["[Best Practice] Element with role=\"scrollbar\" has empty aria-valuemin attribute (4.1.2 A)", "Give the scrollbar's aria-valuemin a numeric value."],
    scrollbarMissingValuemax: ["[Best Practice] Element with role=\"scrollbar\" missing aria-valuemax attribute (4.1.2 A)", "Add aria-valuemax to the scrollbar."],
    scrollbarEmptyValuemax: ["[Best Practice] Element with role=\"scrollbar\" has empty aria-valuemax attribute (4.1.2 A)", "Give the scrollbar's aria-valuemax a numeric value."],
    spinbuttonMissingValuemin: ["[Best Practice] Element with role=\"spinbutton\" missing aria-valuemin attribute (4.1.2 A)", "Add aria-valuemin to the spinbutton."],
    spinbuttonEmptyValuemin: ["[Best Practice] Element with role=\"spinbutton\" has empty aria-valuemin attribute (4.1.2 A)", "Give the spinbutton's aria-valuemin a numeric value."],
    spinbuttonMissingValuemax: ["[Best Practice] Element with role=\"spinbutton\" missing aria-valuemax attribute (4.1.2 A)", "Add aria-valuemax to the spinbutton."],
    spinbuttonEmptyValuemax: ["[Best Practice] Element with role=\"spinbutton\" has empty aria-valuemax attribute (4.1.2 A)", "Give the spinbutton's aria-valuemax a numeric value."],
    progressbarMissingValuemin: ["[Best Practice] Element with role=\"progressbar\" missing aria-valuemin attribute (4.1.2 A)", "Add aria-valuemin to the progressbar."],
    progressbarEmptyValuemin: ["[Best Practice] Element with role=\"progressbar\" has empty aria-valuemin attribute (4.1.2 A)", "Give the progressbar's aria-valuemin a numeric value."],
    progressbarMissingValuemax: ["[Best Practice] Element with role=\"progressbar\" missing aria-valuemax attribute (4.1.2 A)", "Add aria-valuemax to the progressbar."],
    progressbarEmptyValuemax: ["[Best Practice] Element with role=\"progressbar\" has empty aria-valuemax attribute (4.1.2 A)", "Give the progressbar's aria-valuemax a numeric value."],
    rangeMissingMin: ["[Best Practice] Input type=\"range\" missing min attribute (4.1.2 A)", "Add an explicit min attribute to the range input."],
    rangeMissingMax: ["[Best Practice] Input type=\"range\" missing max attribute (4.1.2 A)", "Add an explicit max attribute to the range input."],
  },
  "svg-element-error": {
    svgMissingName: ["[Major] SVG missing accessible name (1.1.1 A)", "Give the SVG a <title>, aria-label or aria-labelledby, or aria-hidden=\"true\" if it is decorative."],
  },
  "svg-element-warning": {
    svgMissingRole: ["[Best Practice] SVG missing role (no role=\"img\", \"graphics-document\", or \"graphics-symbol\") (4.1.2 A)", "Add role=\"img\" (with a name) to meaningful SVGs, or aria-hidden=\"true\" to decorative ones."],
    svgShouldHaveRoleImg: ["[Best Practice] SVG should have role img (4.1.2 A)", "Add role=\"img\" to the SVG so it is exposed as a single image."],
    svgAriaLabelNoRole: ["[Best Practice] SVG has aria-label but no appropriate role attribute (4.1.2 A)", "Add role=\"img\" to the SVG so its aria-label is announced reliably."],
    svgRoleImgNoDescription: ["[Major] SVG with role=\"img\" missing accessible description (no aria-label, title child, or aria-labelledby) (1.1.1 A)", "Give the role=\"img\" SVG a <title>, aria-label or aria-labelledby."],
    svgGenericDescription: ["[Minor] SVG accessible description uses generic text (1.1.1 A)", "Describe what the graphic shows or does instead of generic words like \"icon\"."],
  },
  "tab-element-warning": {
    tabMissingAriaControls: ["[Best Practice] Element with role=\"tab\" missing aria-controls attribute (4.1.2 A)", "Point the tab's aria-controls at the id of its tabpanel."],
    tabpanelMissingAccessibleName: ["[Best Practice] Element with role=\"tabpanel\" missing accessible name (no aria-label or aria-labelledby) (4.1.2 A)", "Name the tabpanel with aria-labelledby pointing at its tab."],
    tablistMissingAccessibleName: ["[Best Practice] Element with role=\"tablist\" missing accessible name (no aria-label or aria-labelledby) (4.1.2 A)", "Name the tablist with aria-label or aria-labelledby."],
  },
  "table-element-error": {
    tableMissingCaptionSummary: ["[Minor] Table missing caption or summary (1.3.1 A)", "Add a <caption> (or aria-label/aria-labelledby) describing the table."],
    tableMissingTh: ["[Major] Table missing th elements (1.3.1 A)", "Mark header cells up as <th>."],
    tableMissingHeaders: ["[Major] Table missing column/row headers (no th, role=columnheader, or role=rowheader) (1.3.1 A)", "Add <th> header cells (or role=\"columnheader\"/\"rowheader\") to the data table."],
    tableEmptyHeader: ["[Major] Empty table header (th with no content) (1.3.1 A)", "Give the header cell text (or use <td> for an empty corner cell)."],
    tableMissingCaption: ["[Minor] Table missing caption element (1.3.1 A)", "Add a <caption> as the first child of the table."],
    tdMissingTrParent: ["[Major] td element is not inside a tr element (1.3.1 A)", "Place <td> cells inside a <tr>."],
    thMissingTrParent: ["[Major] th element is not inside a tr element (1.3.1 A)", "Place <th> cells inside a <tr>."],
    trMissingTableParent: ["[Major] tr element is not inside a table, thead, tbody, or tfoot element (1.3.1 A)", "Place <tr> inside a <table>, <thead>, <tbody> or <tfoot>."],
    tableDeprecatedSummary: ["[Minor] table summary attribute is deprecated — use caption element or aria-label instead (1.3.1 A)", "Move the summary text into a <caption> or aria-describedby and remove summary."],
  },
  "table-element-warning": {
    tableSummaryCaptionMatch: ["[Best Practice] Table summary attribute text matches caption text (should differ) (1.3.1 A)", "Make the summary add information beyond the caption, or remove it."],
    tableRolePresentation: ["[Minor] table element has role=\"none\" or \"presentation\" — verify this is a layout table and not a data table (1.3.1 A)", "Confirm this is a layout table; data tables must keep their table semantics."],
  },
  "textarea-element-error": {
    textareaMissingAssociatedLabel: ["[Major] Textarea missing associated label (1.3.1 A)", "Associate a <label for> with the textarea, or add aria-label/aria-labelledby."],
    textareaMissingNameAttribute: ["[Best Practice] Textarea missing name attribute (1.3.1 A)", "Add a name attribute to the textarea."],
  },
  "textarea-element-warning": {
    textareaPlaceholderLabelSubstitute: ["[Major] Textarea placeholder is not a label substitute (1.3.1 A)", "Add a persistent visible <label>; placeholder text is not a reliable label."],
  },
  "time-element-error": {
    timeElementMissingDatetimeAttribute: ["[Best Practice] time element missing datetime attribute (1.3.1 A)", "Add a machine-readable datetime attribute, e.g. datetime=\"2024-05-01\"."],
  },
  "title-element-error": {
    pageMissingTitleElement: ["[Major] Page missing title element (2.4.2 A)", "Add a <title> in <head> describing the page."],
    titleElementEmpty: ["[Major] title element is empty (2.4.2 A)", "Put a descriptive page title in the <title> element."],
  },
  "track-element-error": {
    trackMissingSrcAttribute: ["[Best Practice] track missing src attribute (1.2.1 A)", "Point the <track> src at a WebVTT file."],
    trackMissingKindAttribute: ["[Best Practice] track missing kind attribute (1.2.2 A)", "Add kind=\"captions\", \"subtitles\" or \"descriptions\" to the <track>."],
    trackMissingSrclangSubtitles: ["[Major] track missing srclang for subtitles (1.2.2 A)", "Add srclang (e.g. srclang=\"en\") to the subtitles track."],
  },
};
