const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("security settings expose the signed-in account identity", () => {
  assert.match(html, /id="accountEmail"/);
  assert.match(html, /id="accountRole"/);
  assert.match(script, /CloudApp\.user/);
  assert.match(script, /accountEmail/);
  assert.match(script, /accountRole/);
});

test("memory photos render as dated timeline groups with inline date edits", () => {
  assert.match(script, /function renderMemoryTimeline\(/);
  assert.match(script, /photo-timeline/);
  assert.match(script, /photo-date-input/);
  assert.match(script, /n\.space === "memory" && n\.type === "图片"/);
  assert.match(css, /\.photo-timeline/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:760px\).*timeline-photo-wall/s);
});
