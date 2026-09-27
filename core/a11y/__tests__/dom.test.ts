// Accessible name, visibility, focusability, selector uniqueness and PII redaction.
import { describe, expect, it } from "vitest";
import { DomCache, accessibleName, cssEscape, isFocusable, isHidden, snippet, uniqueSelector } from "../dom.js";
import { runA11yAudit } from "../engine.js";
import { audit, findingsFor, load } from "./helpers.js";

const $ = (sel: string) => document.querySelector(sel)!;

describe("accessibleName", () => {
  it.each([
    ["aria-labelledby (multiple ids, in order)", '<span id="a">Delete</span><span id="b">file</span><button id="t" aria-labelledby="a b">X</button>', "Delete file"],
    ["aria-labelledby wins over aria-label", '<span id="a">Visible</span><button id="t" aria-labelledby="a" aria-label="Hidden">X</button>', "Visible"],
    ["aria-labelledby to a hidden element still resolves", '<span id="a" hidden>Secret name</span><button id="t" aria-labelledby="a"></button>', "Secret name"],
    ["aria-label", '<button id="t" aria-label="Close dialog">×</button>', "Close dialog"],
    ["label[for]", '<label for="t">Email</label><input id="t" type="email">', "Email"],
    ["wrapping label excludes the control", '<label>Amount <input id="t" type="text"> USD</label>', "Amount USD"],
    ["img alt inside a link", '<a id="t" href="/"><img src="x.png" alt="Home"></a>', "Home"],
    ["content skips aria-hidden and hidden children", '<button id="t"><span aria-hidden="true">★</span><span hidden>x</span>Save</button>', "Save"],
    ["svg <title>", '<svg id="t" role="img"><title>Logo</title></svg>', "Logo"],
    ["title fallback", '<button id="t" title="Settings"></button>', "Settings"],
    ["input button value", '<input id="t" type="button" value="Apply">', "Apply"],
    ["fieldset legend", '<fieldset id="t"><legend>Shipping</legend></fieldset>', "Shipping"],
    ["table caption", '<table id="t"><caption>Totals</caption><tr><td>1</td></tr></table>', "Totals"],
    ["headings from nested content", '<h2 id="t">Plans <em>and</em> pricing</h2>', "Plans and pricing"],
    ["no name from content for generic div", '<div id="t">Just text</div>', ""],
  ])("%s", (_n, html, expected) => {
    load(html);
    expect(accessibleName($("#t"))).toBe(expected);
  });

  it("never reads form field values into names", () => {
    load('<label id="t">Name <input type="text"><textarea>draft</textarea><select><option>Opt</option></select></label>');
    ($("input") as HTMLInputElement).value = "typed secret";
    expect(accessibleName($("#t"))).toBe("Name");
  });

  it("does not use placeholder unless asked", () => {
    load('<input id="t" type="text" placeholder="Search">');
    const dom = new DomCache(document);
    expect(dom.accessibleName($("#t"))).toBe("");
    expect(dom.accessibleName($("#t"), { excludePlaceholder: false })).toBe("Search");
  });
});

describe("visibility", () => {
  it("detects hidden attribute, display:none, visibility:hidden, aria-hidden and inert (incl. ancestors)", () => {
    load(`
      <div hidden><p id="a">a</p></div>
      <div style="display:none"><p id="b">b</p></div>
      <p id="c" style="visibility:hidden">c</p>
      <div aria-hidden="true"><p id="d">d</p></div>
      <div inert><p id="e">e</p></div>
      <details><summary id="s">S</summary><p id="f">f</p></details>
      <p id="v">v</p>`);
    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(isHidden($(`#${id}`)), id).toBe(true);
    expect(isHidden($("#s"))).toBe(false);
    expect(isHidden($("#v"))).toBe(false);
  });

  it("skips findings inside hidden subtrees", () => {
    const r = audit('<div hidden><img src="a.png"><button></button></div><div aria-hidden="true"><img src="b.png"></div><div style="display:none"><a href="/">click here</a></div>');
    expect(findingsFor(r, "img-element-error")).toEqual([]);
    expect(findingsFor(r, "button-element-error")).toEqual([]);
    expect(findingsFor(r, "a-element-warning")).toEqual([]);
  });

  it("still reports rules that are about aria-hidden", () => {
    const r = audit('<nav aria-hidden="true"><a href="/">x</a></nav>');
    expect(findingsFor(r, "landmark-element-warning", "landmarkAriaHidden")).toHaveLength(1);
    expect(findingsFor(r, "aria-element-warning", "ariaHiddenFocusableElement")).toHaveLength(1);
  });
});

describe("isFocusable", () => {
  it.each([
    ['<a id="t" href="/">x</a>', true],
    ['<a id="t">x</a>', false],
    ['<button id="t" disabled>x</button>', false],
    ['<fieldset disabled><input id="t"></fieldset>', false],
    ['<div id="t" tabindex="-1">x</div>', true],
    ['<div id="t">x</div>', false],
    ['<input id="t" type="hidden">', false],
    ['<div hidden><button id="t">x</button></div>', false],
    ['<div inert><button id="t">x</button></div>', false],
    ['<div id="t" contenteditable="true"></div>', true],
    ['<details><summary id="t">s</summary></details>', true],
  ])("%s -> %s", (html, expected) => {
    load(html);
    expect(isFocusable($("#t"))).toBe(expected);
  });
});

describe("uniqueSelector", () => {
  it("produces a selector that matches exactly the element, for every element", () => {
    load(`
      <div id="app"><ul><li>a</li><li>b <span>x</span><span>y</span></li></ul></div>
      <p id="dup">1</p><p id="dup">2</p>
      <section><div><svg><g><path d="M0 0"></path><path d="M1 1"></path></g></svg></div></section>
      <div id="1weird:id.x">n</div><my-widget><p>c</p></my-widget>`);
    const dom = new DomCache(document);
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const sel = dom.uniqueSelector(el);
      const hits = document.querySelectorAll(sel);
      expect(hits.length, sel).toBe(1);
      expect(hits[0], sel).toBe(el);
    }
  });

  it("anchors on the nearest unique id and avoids duplicated ids", () => {
    load('<div id="app"><p>a</p><p>b</p></div><p id="dup">1</p><p id="dup">2</p>');
    expect(uniqueSelector(document.querySelectorAll("#app p")[1])).toBe("#app > p:nth-of-type(2)");
    expect(uniqueSelector(document.querySelectorAll("p")[3])).toBe("body > p:nth-of-type(2)");
  });

  it("escapes like CSS.escape", () => {
    expect(cssEscape("1a")).toBe("\\31 a");
    expect(cssEscape("a:b.c")).toBe("a\\:b\\.c");
    expect(cssEscape("-")).toBe("\\-");
    expect(cssEscape("-1")).toBe("-\\31 ");
  });

  it("is stable across runs", () => {
    load('<main><img src="a.png"><img src="b.png"></main>');
    const a = runA11yAudit(document).findings.map((f) => f.id);
    const b = runA11yAudit(document).findings.map((f) => f.id);
    expect(a).toEqual(b);
  });
});

describe("snippet and PII", () => {
  it("returns the opening tag only, capped at 200 chars", () => {
    load(`<button id="t" class="${"c".repeat(400)}">Secret button text</button>`);
    const s = snippet($("#t"));
    expect(s.startsWith('<button id="t"')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).not.toContain("Secret button text");
  });

  it("redacts value-like attributes and strips URL queries", () => {
    load('<input id="t" type="email" value="ada@example.com" data-user-email="ada@example.com" data-token="abc123" name="email"><a id="l" href="https://x.test/reset?token=s3cr3t#frag">x</a><a id="o" href="/cb#access_token=zzz">y</a>');
    const s = snippet($("#t"));
    expect(s).not.toContain("ada@example.com");
    expect(s).not.toContain("abc123");
    expect(s).toContain('value="[redacted]"');
    expect(snippet($("#l"))).toBe('<a id="l" href="https://x.test/reset?…#frag">');
    expect(snippet($("#o"))).not.toContain("zzz");
  });

  it("never leaks typed values, textarea or contenteditable text into a report", () => {
    load(`
      <input type="text" id="i">
      <textarea id="ta"></textarea>
      <div contenteditable="true" id="ce" aria-label="Editor" role="textbox" tabindex="0"></div>
      <label>Card <input type="text" id="cc" value="4111111111111111"></label>
      <button><span contenteditable="true">EDITABLESECRET</span></button>`);
    ($("#i") as HTMLInputElement).value = "TYPEDSECRET";
    ($("#ta") as HTMLTextAreaElement).value = "TEXTAREASECRET";
    $("#ce").textContent = "CONTENTEDITABLESECRET";
    const json = JSON.stringify(runA11yAudit(document));
    for (const secret of ["TYPEDSECRET", "TEXTAREASECRET", "CONTENTEDITABLESECRET", "4111111111111111", "EDITABLESECRET"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("reports origin + path only", () => {
    load("<p>x</p>");
    const r = runA11yAudit(document);
    expect(r.url).not.toContain("?");
    expect(r.url).not.toContain("#");
  });
});
