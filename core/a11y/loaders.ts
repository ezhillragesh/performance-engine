// Loading the vendored rule engines into a page without touching the page's own globals.
//
// Both engines are shipped unchanged (extension/vendor/ibm-ace.js, extension/vendor/axe.min.js);
// these helpers wrap their source text so that evaluating the wrapped string (inspectedWindow.eval,
// window.eval, new Function) installs them under private names:
//   window.__PERF_INTEL_ACE__ = { ace, version }   IBM Equal Access engine
//   window.__PERF_INTEL_AXE__ = { axe, version }   axe-core
// - ace.js declares a top-level `var ace` (a page global when run as a classic script). Inside the
//   wrapper function it is function-scoped, so window.ace is never created or overwritten.
// - axe.min.js is UMD: it calls define() when an AMD loader exists, sets module.exports when
//   `module` exists, and always assigns window.axe. The wrapper shadows define/module/exports and
//   restores (or deletes) window.axe afterwards, so a page's own axe survives.
// The wrapped expression evaluates to the installed version string. Re-evaluating it is a no-op
// while the same version is installed.

/** Versions of the vendored engines (kept in sync with core/package.json; checked by the tests). */
export const IBM_ACE_VERSION = "4.0.34";
export const AXE_CORE_VERSION = "4.13.0";

export const ACE_GLOBAL_KEY = "__PERF_INTEL_ACE__";
export const AXE_GLOBAL_KEY = "__PERF_INTEL_AXE__";

const define = (key: string, value: string) =>
  `Object.defineProperty(g,${JSON.stringify(key)},{value:${value},configurable:true,writable:true,enumerable:false})`;

/** Wraps ace.js source so evaluating it installs window.__PERF_INTEL_ACE__ (never window.ace). */
export function wrapAceSource(source: string, version: string = IBM_ACE_VERSION): string {
  const v = JSON.stringify(version);
  const k = JSON.stringify(ACE_GLOBAL_KEY);
  return (
    `(function(){var g=window,cur=g[${k}];if(cur&&cur.version===${v}&&cur.ace)return cur.version;` +
    `var ace=(function(define,module,exports){\n${source}\n;return ace;}).call(g);` +
    `if(!ace||typeof ace.Checker!=="function")throw new Error("Accessibility rules failed to load");` +
    `${define(ACE_GLOBAL_KEY, `{ace:ace,version:${v}}`)};return ${v};})()`
  );
}

/** Wraps axe.min.js source so evaluating it installs window.__PERF_INTEL_AXE__ and leaves window.axe as it was. */
export function wrapAxeSource(source: string, version: string = AXE_CORE_VERSION): string {
  const k = JSON.stringify(AXE_GLOBAL_KEY);
  const v = JSON.stringify(version);
  return (
    `(function(){var g=window,cur=g[${k}];if(cur&&cur.version===${v}&&cur.axe)return cur.version;var hasOwn=Object.prototype.hasOwnProperty;` +
    `var had=hasOwn.call(g,"axe"),prev=had?g.axe:undefined,ours=null;` +
    `try{(function(define,module,exports){\n${source}\n}).call(g);ours=g.axe;}` +
    `finally{try{if(had){if(g.axe!==prev)g.axe=prev;}else if(hasOwn.call(g,"axe"))delete g.axe;}catch(e){}}` +
    `if(!ours||typeof ours.run!=="function")throw new Error("Accessibility rules failed to load");` +
    `${define(AXE_GLOBAL_KEY, "{axe:ours,version:String(ours.version)}")};return String(ours.version);})()`
  );
}

/** Probe expression: installed versions as { ace, axe } (null when missing). */
export const ENGINES_PROBE_EXPR =
  `(function(){try{var a=window[${JSON.stringify(ACE_GLOBAL_KEY)}],x=window[${JSON.stringify(AXE_GLOBAL_KEY)}];` +
  `return {ace:a&&a.ace?String(a.version):null,axe:x&&x.axe?String(x.version):null}}catch(e){return {ace:null,axe:null}}})()`;
