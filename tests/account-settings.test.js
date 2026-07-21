const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");

test("security settings expose the signed-in account identity", () => {
  assert.match(html, /id="accountEmail"/);
  assert.match(html, /id="accountRole"/);
  assert.match(script, /CloudApp\.user/);
  assert.match(script, /accountEmail/);
  assert.match(script, /accountRole/);
});
