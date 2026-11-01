import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTACHMENT_BYTES, isEmail, sendProblems, uniqueAddresses } from "./email.ts";

test("isEmail accepts ordinary addresses and rejects junk", () => {
  assert.equal(isEmail("drafter@example.com.au"), true);
  assert.equal(isEmail(" a.b+c@x.io "), true);
  assert.equal(isEmail("nobody"), false);
  assert.equal(isEmail("a@b"), false);
  assert.equal(isEmail("a@b.com, c@d.com"), false);
});

test("sendProblems names each thing in the way", () => {
  assert.deepEqual(sendProblems({ to: ["a@b.com"], subject: "Hi", attachmentBytes: 10 }), []);
  const problems = sendProblems({ to: ["oops"], subject: " ", attachmentBytes: MAX_ATTACHMENT_BYTES + 1 });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /oops/);
  assert.deepEqual(sendProblems({ to: [], subject: "x", attachmentBytes: 0 }), ["Pick or type at least one recipient."]);
});

test("uniqueAddresses drops blanks and repeats, case aside", () => {
  assert.deepEqual(uniqueAddresses(["A@b.com", "a@B.com", " ", "c@d.com"]), ["A@b.com", "c@d.com"]);
});
