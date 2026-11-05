import assert from "node:assert/strict";
import { test } from "node:test";
import { keyboardIsOpen, scrollToShow } from "../lib/keep-field-in-view.ts";

test("the keyboard is told apart from a browser's address bar coming and going", () => {
  assert.equal(keyboardIsOpen(740, 420), true);
  assert.equal(keyboardIsOpen(740, 684), false);
  assert.equal(keyboardIsOpen(740, 740), false);
});

test("a field already clear of the keyboard is not moved", () => {
  assert.equal(scrollToShow({ top: 100, bottom: 144 }, { top: 0, bottom: 420 }), 0);
});

test("a field behind the keyboard, or above the screen, goes to the middle of what is visible", () => {
  assert.equal(scrollToShow({ top: 500, bottom: 544 }, { top: 0, bottom: 420 }), 300);
  assert.equal(scrollToShow({ top: -100, bottom: -56 }, { top: 0, bottom: 420 }), -300);
});

test("a field hard against the top moves so its label shows", () => {
  assert.notEqual(scrollToShow({ top: 10, bottom: 54 }, { top: 0, bottom: 420 }), 0);
});

test("what is visible is measured from where it really starts, when a phone has moved the screen up", () => {
  assert.equal(scrollToShow({ top: 400, bottom: 444 }, { top: 200, bottom: 620 }), 0);
});

test("a field taller than what is visible shows its start", () => {
  assert.equal(scrollToShow({ top: 300, bottom: 900 }, { top: 0, bottom: 420 }), 260);
});
